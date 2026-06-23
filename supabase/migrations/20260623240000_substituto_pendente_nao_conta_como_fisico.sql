-- Substituto de troca (a-receber) era contado como estoque FÍSICO: o item
-- substituto entra na OC com quantidade_recebida=NULL e os cálculos de físico
-- usavam COALESCE(recebida, pedida) -> contavam a pedida como se já tivesse
-- chegado (estoque-fantasma que podia liberar reserva/corte antes da reposição).
-- Correção: quando substitui_item_id IS NOT NULL e recebida IS NULL, o físico
-- conta 0 (não a pedida). Aplicado nos 3 RPCs de físico; o 'previsto/prev_receb'
-- segue usando a pedida (a reposição É esperada). Gerado por substituição exata
-- da string sobre o corpo vivo (pg_get_functiondef) -> sem risco de transcrição.

CREATE OR REPLACE FUNCTION public.detalhe_estoque_variante(_variante_id uuid)
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
      oc.id AS oc_id,
      oc.numero_pedido,
      COALESCE(oc.data_entrega, oc.data_prevista_entrega) AS data_entrega,
      oc.created_at,
      e.nome_fantasia AS fornecedor,
      (oc.status = 'recebido') AS recebida,
      COALESCE(it.estoque_zerado, false) AS estoque_zerado,
      CASE WHEN oc.status = 'recebido' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_pedida,0) END AS prev_receb_m,
      CASE WHEN it.estoque_zerado THEN 0
           WHEN oc.status <> 'recebido' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END AS recebido_m,
      COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0) AS baixado_m,
      CASE WHEN it.estoque_zerado THEN 0 ELSE COALESCE((
        SELECT SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
                   * COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
                   * COALESCE((SELECT mtv.multiplicador FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem),1))
        FROM public.modelo_tecido_oc_links l
        JOIN public.modelo_tecidos mt
          ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
        WHERE l.oc_tecido_item_id = it.id
          AND NOT EXISTS (
            SELECT 1 FROM public.cad c
            JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
            WHERE c.modelo_id = l.modelo_id
          )
      ),0) END AS reservado_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.empresas e ON e.id = oc.empresa_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status IN ('recebido', 'encomendado')
      AND COALESCE(it.cancelado, false) = false
      AND it.variante_tecido_id = _variante_id
  ) t;
  RETURN v_result;
END;
$function$

;

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
                                 ELSE (CASE WHEN a.unidade_medida = 'kg'
                                            THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento,0)
                                            ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END)
                                      -- desconta remoções físicas (separação de rolo / ajuste), que não são consumo de modelo
                                      - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas
                                                  WHERE oc_tecido_item_id = it.id AND origem IN ('separacao_rolo','ajuste')),0)
                                 END,
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

CREATE OR REPLACE FUNCTION public._dashboard_estoque_parado_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'porArtigo', '[]'::jsonb);
  END IF;

  WITH recebido AS (
    SELECT it.artigo_id,
      SUM(CASE WHEN a.unidade_medida = 'kg'
               THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento, 0)
               ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0)
          END) AS m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status = 'recebido'
      AND COALESCE(it.cancelado, false) = false
      AND it.artigo_id IS NOT NULL
    GROUP BY it.artigo_id
  ),
  baixa AS (
    SELECT ct.artigo_id, SUM(COALESCE(ctv.metragem_enviada, 0)) AS m
    FROM public.cad_tecido_variantes ctv
    JOIN public.cad_tecidos ct ON ct.id = ctv.cad_tecido_id
    JOIN public.cad c ON c.id = ct.cad_id
    WHERE c.tenant_id = v_tenant
      AND c.enviado_corte = true
      AND ct.artigo_id IS NOT NULL
    GROUP BY ct.artigo_id
  ),
  reservado AS (
    SELECT mt.artigo_id,
      SUM(COALESCE(mt.consumo, 0) * (1 + COALESCE(mt.loss_percent, 0) / 100.0) * COALESCE(mg.grade_total, 0) * COALESCE(mtv.multiplicador, 1)) AS m
    FROM public.modelo_tecidos mt
    JOIN public.modelos m ON m.id = mt.modelo_id
    JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
    LEFT JOIN public.modelo_grades mg
      ON mg.modelo_id = mt.modelo_id AND mg.variante_numero = mtv.ordem
    WHERE m.tenant_id = v_tenant
      AND mt.artigo_id IS NOT NULL
      AND LOWER(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
      AND NOT EXISTS (
        SELECT 1 FROM public.cad c
        WHERE c.modelo_id = m.id AND COALESCE(c.enviado_corte, false) = true
      )
    GROUP BY mt.artigo_id
  ),
  artigos_all AS (
    SELECT artigo_id FROM recebido
    UNION SELECT artigo_id FROM baixa
    UNION SELECT artigo_id FROM reservado
  ),
  val AS (
    SELECT a.nome,
      GREATEST(COALESCE(r.m, 0) - COALESCE(b.m, 0) - COALESCE(rs.m, 0), 0)::numeric
        * COALESCE(a.preco_por_metro, 0)::numeric AS valor
    FROM artigos_all aa
    JOIN public.artigos a ON a.id = aa.artigo_id
    LEFT JOIN recebido r ON r.artigo_id = aa.artigo_id
    LEFT JOIN baixa b ON b.artigo_id = aa.artigo_id
    LEFT JOIN reservado rs ON rs.artigo_id = aa.artigo_id
  ),
  pos AS (SELECT nome, ROUND(valor, 2) AS valor FROM val WHERE valor > 0)
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT SUM(valor) FROM pos), 0),
    'porArtigo', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', valor) ORDER BY valor DESC)
                           FROM (SELECT nome, valor FROM pos ORDER BY valor DESC LIMIT 8) t), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$

;

