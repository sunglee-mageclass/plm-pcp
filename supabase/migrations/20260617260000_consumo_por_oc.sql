-- View "Consumo por OC" (Produção): para cada OC de tecido, os itens (variantes) e
-- os modelos que consomem deles, com consumo planejado (vínculo, não cortado) e
-- consumo baixado (real, pós-corte). Read-only — não grava nada.
-- Consumo planejado = consumo × multiplicador × (grade_total + 1)  [SEM perda; +1 = peça piloto].
-- Espelha os joins de detalhe_estoque_variante (20260616233000).
CREATE OR REPLACE FUNCTION public.consumo_por_oc()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(oc_row ORDER BY sort_key DESC NULLS LAST), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      COALESCE(oc.data_entrega, oc.data_prevista_entrega) AS sort_key,
      jsonb_build_object(
        'oc_id', oc.id,
        'numero_pedido', oc.numero_pedido,
        'status', oc.status,
        'data_entrega', COALESCE(oc.data_entrega, oc.data_prevista_entrega),
        'fornecedor', e.nome_fantasia,
        'itens', COALESCE((
          SELECT jsonb_agg(item_row)
          FROM (
            SELECT jsonb_build_object(
              'oc_tecido_item_id', it.id,
              'artigo_nome', a.nome,
              'unidade', a.unidade_medida,
              'variante', COALESCE(vt.nome_variante, vt.codigo_variante, cor.nome, '—'),
              'pedido_m', CASE WHEN a.unidade_medida = 'kg'
                               THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
                               ELSE COALESCE(it.quantidade_pedida,0) END,
              'recebido_m', CASE WHEN oc.status <> 'recebido' THEN 0
                                 WHEN a.unidade_medida = 'kg'
                                 THEN COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.rendimento,0)
                                 ELSE COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) END,
              'baixado_m', COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0),
              'modelos', (
                SELECT COALESCE(jsonb_agg(m_row), '[]'::jsonb) FROM (
                  -- Planejados: vínculo explícito, modelo ainda não cortado.
                  SELECT jsonb_build_object(
                    'modelo_id', l.modelo_id,
                    'ref', md.ref,
                    'nome', md.nome,
                    'origem', 'planejado',
                    'consumo_m', COALESCE(mt.consumo,0)
                      * COALESCE((SELECT mtv.multiplicador FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem),1)
                      * (COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0) + 1)
                  ) AS m_row
                  FROM public.modelo_tecido_oc_links l
                  JOIN public.modelo_tecidos mt ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
                  JOIN public.modelos md ON md.id = l.modelo_id
                  WHERE l.oc_tecido_item_id = it.id
                    AND NOT EXISTS (
                      SELECT 1 FROM public.cad c
                      JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
                      WHERE c.modelo_id = l.modelo_id
                    )
                  UNION ALL
                  -- Baixados: consumo real pós-corte.
                  SELECT jsonb_build_object(
                    'modelo_id', md.id,
                    'ref', md.ref,
                    'nome', md.nome,
                    'origem', 'baixado',
                    'consumo_m', SUM(b.quantidade)
                  )
                  FROM public.estoque_tecido_baixas b
                  JOIN public.cad c ON c.id = b.cad_id
                  JOIN public.modelos md ON md.id = c.modelo_id
                  WHERE b.oc_tecido_item_id = it.id
                  GROUP BY md.id, md.ref, md.nome
                ) mm
              )
            ) AS item_row
            FROM public.ocs_tecido_itens it
            LEFT JOIN public.artigos a ON a.id = it.artigo_id
            LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
            LEFT JOIN public.cores cor ON cor.id = vt.cor_id
            WHERE it.oc_tecido_id = oc.id
              AND COALESCE(it.cancelado, false) = false
            ORDER BY a.nome
          ) itens_sub
        ), '[]'::jsonb)
      ) AS oc_row
    FROM public.ocs_tecido oc
    LEFT JOIN public.empresas e ON e.id = oc.empresa_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status IN ('recebido', 'encomendado')
  ) ocs;
  RETURN v_result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.consumo_por_oc() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consumo_por_oc() TO authenticated;

NOTIFY pgrst, 'reload schema';
