-- ocs_para_rolo: inclui o nome do tecido (artigo) em cada item, para a seleção
-- de separação mostrar "Tecido · Variante".
CREATE OR REPLACE FUNCTION public.ocs_para_rolo()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(oc_row ORDER BY numero_pedido), '[]'::jsonb)
  FROM (
    SELECT oc.numero_pedido,
      jsonb_build_object(
        'oc_id', oc.id,
        'numero_pedido', oc.numero_pedido,
        'itens', itens.arr
      ) AS oc_row
    FROM public.ocs_tecido oc
    JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'oc_tecido_item_id', it.id,
               'artigo_id', it.artigo_id,
               'artigo_nome', a.nome,
               'variante_tecido_id', it.variante_tecido_id,
               'variante', COALESCE(vt.nome_variante, vt.codigo_variante, '—'),
               'disponivel_m', disp.m
             ) ORDER BY a.nome, vt.nome_variante) AS arr
      FROM public.ocs_tecido_itens it
      LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
      LEFT JOIN public.artigos a ON a.id = it.artigo_id
      CROSS JOIN LATERAL (
        SELECT (CASE WHEN a.unidade_medida = 'kg'
                     THEN COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.rendimento,0)
                     ELSE COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) END)
               - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0) AS m
      ) disp
      WHERE it.oc_tecido_id = oc.id
        AND it.variante_tecido_id IS NOT NULL
        AND COALESCE(it.cancelado, false) = false
        AND COALESCE(it.estoque_zerado, false) = false
        AND disp.m > 0.0001
    ) itens ON itens.arr IS NOT NULL
    WHERE oc.tenant_id = public.get_user_tenant_id()
      AND oc.status = 'recebido'
      AND COALESCE(oc.is_rolo, false) = false
  ) t;
$function$;

REVOKE EXECUTE ON FUNCTION public.ocs_para_rolo() FROM anon;
