-- Fase 1 — Estoque zerado: marca um item de OC como zerado (rolo acabou),
-- zerando a sobra/negativo daquele item no estoque real, na seleção de OC do
-- corte (ocs_disponiveis_variante) e no dashboard de estoque.
ALTER TABLE public.ocs_tecido_itens ADD COLUMN IF NOT EXISTS estoque_zerado boolean NOT NULL DEFAULT false;

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
              'estoque_zerado', COALESCE(it.estoque_zerado, false),
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
CREATE OR REPLACE FUNCTION public.ocs_disponiveis_variante(_variante_id uuid, _modelo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recebida DESC, data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.numero_pedido,
      oc.data_entrega,
      oc.created_at,
      (oc.status = 'recebido') AS recebida,
      CASE WHEN it.estoque_zerado THEN 0 ELSE (
        (CASE
           WHEN oc.status = 'recebido' THEN
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_recebida,0) END
           ELSE
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_pedida,0) END
         END)
        - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
        - COALESCE((
            SELECT SUM(COALESCE(l.quantidade_m,0))
            FROM public.modelo_tecido_oc_links l
            WHERE l.oc_tecido_item_id = it.id
              AND (_modelo_id IS NULL OR l.modelo_id <> _modelo_id)
              AND NOT EXISTS (
                SELECT 1 FROM public.cad c
                JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
                WHERE c.modelo_id = l.modelo_id
              )
          ),0)
      ) END AS disponivel_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND it.variante_tecido_id = _variante_id
  ) t;
  RETURN v_result;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.dashboard_estoque()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_threshold numeric := 0;
  v_total_var int;
  v_total_avi int;
  v_zerados int;
  v_top10 jsonb;
  v_bar jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT COALESCE(estoque_critico_threshold, 0) INTO v_threshold
  FROM tenant_config WHERE tenant_id = v_tenant;
  v_threshold := COALESCE(v_threshold, 0);

  WITH rec AS (
    SELECT it.variante_tecido_id,
           SUM(CASE
                 WHEN it.estoque_zerado
                   THEN COALESCE((SELECT SUM(quantidade) FROM estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
                 WHEN a.unidade_medida='kg' THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
                 ELSE COALESCE(it.quantidade_recebida,0) END) AS total
    FROM ocs_tecido_itens it
    JOIN ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = v_tenant
    LEFT JOIN artigos a ON a.id = it.artigo_id
    WHERE it.variante_tecido_id IS NOT NULL
    GROUP BY it.variante_tecido_id
  ),
  baixa AS (
    SELECT cv.variante_tecido_id, SUM(COALESCE(cv.metragem_enviada,0)) AS total
    FROM cad_tecido_variantes cv
    JOIN cad_tecidos ct ON ct.id = cv.cad_tecido_id
    JOIN cad c ON c.id = ct.cad_id AND c.tenant_id = v_tenant AND c.enviado_corte
    WHERE cv.variante_tecido_id IS NOT NULL
    GROUP BY cv.variante_tecido_id
  ),
  tec AS (
    SELECT v.id,
           (COALESCE(art.nome,'—') || ' · ' || COALESCE(v.nome_variante, v.codigo_variante, co.nome, '—')) AS nome,
           COALESCE(cat.nome,'Sem categoria') AS categoria,
           (COALESCE(rec.total,0) - COALESCE(baixa.total,0)) AS estoque,
           'Tecido' AS tipo
    FROM variantes_tecido v
    JOIN artigos art ON art.id = v.artigo_id AND art.tenant_id = v_tenant
    LEFT JOIN cores co ON co.id = v.cor_id
    LEFT JOIN categorias_tecido cat ON cat.id = art.categoria_tecido_id
    LEFT JOIN rec   ON rec.variante_tecido_id = v.id
    LEFT JOIN baixa ON baixa.variante_tecido_id = v.id
  ),
  avi_rec AS (
    SELECT i.aviamento_id, SUM(COALESCE(i.quantidade_recebida,0)) AS total
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant
    WHERE i.aviamento_id IS NOT NULL
    GROUP BY i.aviamento_id
  ),
  avi_baixa AS (
    SELECT ca.aviamento_id, SUM(COALESCE(ca.quantidade_enviar,0)) AS total
    FROM cad_aviamentos ca
    JOIN cad c ON c.id = ca.cad_id AND c.tenant_id = v_tenant AND c.enviado_corte
    WHERE ca.aviamento_id IS NOT NULL
    GROUP BY ca.aviamento_id
  ),
  avi AS (
    SELECT a.id, a.codigo_nome AS nome, 'Aviamento'::text AS categoria,
           (COALESCE(r.total,0) - COALESCE(b.total,0)) AS estoque,
           'Aviamento' AS tipo
    FROM aviamentos a
    LEFT JOIN avi_rec r ON r.aviamento_id = a.id
    LEFT JOIN avi_baixa b ON b.aviamento_id = a.id
    WHERE a.tenant_id = v_tenant
  ),
  all_items AS (SELECT * FROM tec UNION ALL SELECT * FROM avi)
  SELECT
    (SELECT count(*) FROM variantes_tecido v JOIN artigos a ON a.id=v.artigo_id AND a.tenant_id=v_tenant),
    (SELECT count(*) FROM aviamentos WHERE tenant_id = v_tenant),
    (SELECT count(*) FROM all_items WHERE estoque <= v_threshold),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'tipo',tipo,'estoque',estoque) ORDER BY estoque ASC)
              FROM (SELECT id,nome,tipo,estoque FROM all_items ORDER BY estoque ASC LIMIT 10) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'total',total))
              FROM (SELECT categoria, SUM(GREATEST(0,estoque)) AS total FROM tec GROUP BY categoria) c), '[]'::jsonb)
  INTO v_total_var, v_total_avi, v_zerados, v_top10, v_bar;

  RETURN jsonb_build_object(
    'totalVariantes', v_total_var,
    'totalAviamentos', v_total_avi,
    'zerados', v_zerados,
    'threshold', v_threshold,
    'top10', v_top10,
    'barData', v_bar
  );
END;
$function$

;
