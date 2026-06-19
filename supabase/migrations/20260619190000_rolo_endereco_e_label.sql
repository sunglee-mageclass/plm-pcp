-- Rolos: endereçamento (rua/prateleira) e rótulo "Rolo" no Consumo por OC.
ALTER TABLE public.ocs_tecido
  ADD COLUMN IF NOT EXISTS rolo_rua text,
  ADD COLUMN IF NOT EXISTS rolo_prateleira text;

-- criar_rolo agora aceita endereço (rua/prateleira). Substitui a versão de 4 args.
DROP FUNCTION IF EXISTS public.criar_rolo(text, uuid, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.criar_rolo(
  _codigo text,
  _artigo_id uuid,
  _variantes jsonb,
  _origem_item_id uuid DEFAULT NULL::uuid,
  _rua text DEFAULT NULL::text,
  _prateleira text DEFAULT NULL::text
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rolo_id uuid;
  v_unidade text;
  v_rend numeric;
  v_item jsonb;
  v_var uuid;
  v_metragem numeric;
  v_qtd numeric;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT unidade_medida, COALESCE(rendimento,0) INTO v_unidade, v_rend
  FROM public.artigos WHERE id = _artigo_id;

  INSERT INTO public.ocs_tecido (tenant_id, is_rolo, rolo_codigo, rolo_origem_item_id,
                                 rolo_rua, rolo_prateleira,
                                 status, data_pedido, data_entrega, numero_pedido)
  VALUES (v_tenant, true, _codigo, _origem_item_id,
          NULLIF(_rua,''), NULLIF(_prateleira,''),
          'recebido', current_date, current_date,
          COALESCE(NULLIF(_codigo,''), 'ROLO'))
  RETURNING id INTO v_rolo_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes, '[]'::jsonb)) LOOP
    v_var := NULLIF(v_item->>'variante_tecido_id','')::uuid;
    v_metragem := COALESCE((v_item->>'metragem')::numeric, 0);
    IF v_var IS NULL OR v_metragem <= 0 THEN CONTINUE; END IF;

    v_qtd := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN v_metragem / v_rend ELSE v_metragem END;

    INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id,
                                         quantidade_pedida, quantidade_recebida)
    VALUES (v_rolo_id, _artigo_id, v_var, v_qtd, v_qtd);

    IF _origem_item_id IS NOT NULL THEN
      INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id,
                                                variante_tecido_id, quantidade, origem, rolo_id)
      VALUES (v_tenant, NULL, _origem_item_id, v_var, v_metragem, 'separacao_rolo', v_rolo_id);
    END IF;
  END LOOP;

  RETURN v_rolo_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.criar_rolo(text, uuid, jsonb, uuid, text, text) FROM anon;

-- Consumo por OC expõe is_rolo/rolo_codigo/endereço (rótulo Rolo + aba separada).
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
        'is_rolo', COALESCE(oc.is_rolo, false),
        'rolo_codigo', oc.rolo_codigo,
        'rolo_rua', oc.rolo_rua,
        'rolo_prateleira', oc.rolo_prateleira,
        'status', oc.status,
        'data_entrega', COALESCE(oc.data_entrega, oc.data_prevista_entrega),
        'fornecedor', e.nome_fantasia,
        'itens', COALESCE((
          SELECT jsonb_agg(item_row)
          FROM (
            SELECT jsonb_build_object(
              'oc_tecido_item_id', it.id,
              'estoque_zerado', COALESCE(it.estoque_zerado, false),
              -- Só pode zerar quando todos os modelos vinculados a este item já
              -- foram enviados ao corte (cad.enviado_corte).
              'pode_zerar', (
                EXISTS (SELECT 1 FROM public.modelo_tecido_oc_links lz WHERE lz.oc_tecido_item_id = it.id AND lz.tipo <> 'entretela')
                AND NOT EXISTS (
                  SELECT 1 FROM public.modelo_tecido_oc_links l2
                  WHERE l2.oc_tecido_item_id = it.id
                    AND l2.tipo <> 'entretela'
                    AND NOT EXISTS (SELECT 1 FROM public.cad c2 WHERE c2.modelo_id = l2.modelo_id AND c2.enviado_corte)
                )
              ),
              'artigo_id', it.artigo_id,
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
                  SELECT jsonb_build_object(
                    'modelo_id', l.modelo_id,
                    'ref', md.ref,
                    'nome', md.nome,
                    'consumo_unit', COALESCE(mt.consumo,0),
                    'mult', COALESCE(mtv.multiplicador,1),
                    'grade_variante', COALESCE(gv.grade_total,0),
                    'grade_geral', COALESCE(gg.total,0),
                    'metragem_m', COALESCE(mt.consumo,0) * COALESCE(mtv.multiplicador,1) * COALESCE(gv.grade_total,0),
                    'baixado_m', COALESCE(bx.baixado,0),
                    'cortado', COALESCE(bx.baixado,0) > 0
                  ) AS m_row
                  FROM public.modelo_tecido_oc_links l
                  JOIN public.modelo_tecidos mt ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
                  JOIN public.modelos md ON md.id = l.modelo_id
                  LEFT JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem
                  LEFT JOIN public.modelo_grades gv ON gv.modelo_id = l.modelo_id AND gv.variante_numero = l.ordem
                  LEFT JOIN LATERAL (SELECT SUM(grade_total) AS total FROM public.modelo_grades WHERE modelo_id = l.modelo_id) gg ON true
                  LEFT JOIN LATERAL (
                    SELECT SUM(b.quantidade) AS baixado
                    FROM public.estoque_tecido_baixas b JOIN public.cad c ON c.id = b.cad_id
                    WHERE b.oc_tecido_item_id = it.id AND c.modelo_id = l.modelo_id
                  ) bx ON true
                  WHERE l.oc_tecido_item_id = it.id
                    AND l.tipo <> 'entretela'
                    AND md.status_planejamento IS DISTINCT FROM 'reprovado'
                    AND COALESCE(md.status_desenvolvimento,'') <> 'reprovado'

                  UNION ALL

                  SELECT jsonb_build_object(
                    'modelo_id', bxa.modelo_id,
                    'ref', md.ref,
                    'nome', md.nome,
                    'consumo_unit', COALESCE(bom.consumo,0),
                    'mult', COALESCE(bom.mult,1),
                    'grade_variante', COALESCE(gv.grade_total,0),
                    'grade_geral', COALESCE(gg.total,0),
                    'metragem_m', COALESCE(bom.consumo,0) * COALESCE(bom.mult,1) * COALESCE(gv.grade_total,0),
                    'baixado_m', bxa.baixado,
                    'cortado', true
                  ) AS m_row
                  FROM (
                    SELECT c.modelo_id, SUM(b.quantidade) AS baixado
                    FROM public.estoque_tecido_baixas b JOIN public.cad c ON c.id = b.cad_id
                    WHERE b.oc_tecido_item_id = it.id
                      AND NOT EXISTS (
                        SELECT 1 FROM public.modelo_tecido_oc_links l2
                        WHERE l2.oc_tecido_item_id = it.id AND l2.modelo_id = c.modelo_id
                      )
                    GROUP BY c.modelo_id
                  ) bxa
                  JOIN public.modelos md ON md.id = bxa.modelo_id
                  JOIN LATERAL (
                    SELECT mt2.consumo, mtv2.multiplicador AS mult, mtv2.ordem
                    FROM public.modelo_tecido_variantes mtv2
                    JOIN public.modelo_tecidos mt2 ON mt2.id = mtv2.modelo_tecido_id
                    WHERE mt2.modelo_id = bxa.modelo_id
                      AND mtv2.variante_tecido_id = it.variante_tecido_id
                      AND mt2.tipo <> 'entretela'
                    LIMIT 1
                  ) bom ON true
                  LEFT JOIN public.modelo_grades gv ON gv.modelo_id = bxa.modelo_id AND gv.variante_numero = bom.ordem
                  LEFT JOIN LATERAL (SELECT SUM(grade_total) AS total FROM public.modelo_grades WHERE modelo_id = bxa.modelo_id) gg ON true
                  WHERE md.status_planejamento IS DISTINCT FROM 'reprovado'
                    AND COALESCE(md.status_desenvolvimento,'') <> 'reprovado'
                ) mm
              )
            ) AS item_row
            FROM public.ocs_tecido_itens it
            LEFT JOIN public.artigos a ON a.id = it.artigo_id
            LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
            LEFT JOIN public.cores cor ON cor.id = vt.cor_id
            WHERE it.oc_tecido_id = oc.id
              AND COALESCE(it.cancelado, false) = false
              -- Oculta o item que é entretela (vínculo de entretela e nenhum de outro tipo).
              AND NOT (
                EXISTS (SELECT 1 FROM public.modelo_tecido_oc_links le WHERE le.oc_tecido_item_id = it.id AND le.tipo = 'entretela')
                AND NOT EXISTS (SELECT 1 FROM public.modelo_tecido_oc_links lo WHERE lo.oc_tecido_item_id = it.id AND lo.tipo <> 'entretela')
              )
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
$function$

;
