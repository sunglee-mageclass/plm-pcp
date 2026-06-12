
-- =====================================================
-- Dashboard RPCs — aggregated, tenant-scoped, period-filtered
-- =====================================================

-- ============ COLEÇÃO ============
CREATE OR REPLACE FUNCTION public.dashboard_colecao(
  p_mes uuid DEFAULT NULL,
  p_ano uuid DEFAULT NULL,
  p_semana int DEFAULT NULL,
  p_colecao text DEFAULT NULL,
  p_estilista uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_result jsonb;
  v_total int := 0;
  v_planejamento int := 0;
  v_desenvolvimento int := 0;
  v_producao int := 0;
  v_lancados int := 0;
  v_aprovados int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH m AS (
    SELECT mo.id, mo.status_planejamento, mo.enviado_cad, mo.data_aprovacao,
           mo.categoria_principal_id,
           EXISTS(SELECT 1 FROM cad c WHERE c.modelo_id = mo.id AND c.enviado_corte) AS in_producao,
           EXISTS(SELECT 1 FROM lancamentos l WHERE l.modelo_id = mo.id) AS lancado
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_mes IS NULL OR mo.mes_id = p_mes)
      AND (p_ano IS NULL OR mo.ano_id = p_ano)
      AND (p_semana IS NULL OR mo.semana = p_semana)
      AND (p_colecao IS NULL OR mo.colecao = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE lancado),
    count(*) FILTER (WHERE in_producao),
    count(*) FILTER (WHERE data_aprovacao IS NOT NULL AND NOT enviado_cad),
    count(*) FILTER (WHERE data_aprovacao IS NULL AND status_planejamento IS NOT NULL),
    count(*) FILTER (WHERE data_aprovacao IS NOT NULL)
  INTO v_total, v_lancados, v_producao, v_desenvolvimento, v_planejamento, v_aprovados
  FROM m;

  v_result := jsonb_build_object(
    'kpis', jsonb_build_object(
      'total', v_total,
      'planejamento', v_planejamento,
      'desenvolvimento', v_desenvolvimento,
      'producao', v_producao,
      'lancados', v_lancados
    ),
    'funnel', jsonb_build_array(
      jsonb_build_object('name','Planejados','value', v_total),
      jsonb_build_object('name','Aprovados','value', v_aprovados),
      jsonb_build_object('name','Produção','value', v_producao),
      jsonb_build_object('name','Lançados','value', v_lancados)
    ),
    'pie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('name', nome, 'value', total))
      FROM (
        SELECT COALESCE(cp.nome, 'Sem categoria') AS nome, count(*) AS total
        FROM modelos mo
        LEFT JOIN categorias_produto cp ON cp.id = mo.categoria_principal_id
        WHERE mo.tenant_id = v_tenant
          AND (p_mes IS NULL OR mo.mes_id = p_mes)
          AND (p_ano IS NULL OR mo.ano_id = p_ano)
          AND (p_semana IS NULL OR mo.semana = p_semana)
          AND (p_colecao IS NULL OR mo.colecao = p_colecao)
          AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
        GROUP BY 1
      ) x
    ), '[]'::jsonb),
    'filtros', jsonb_build_object(
      'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM meses WHERE tenant_id = v_tenant), '[]'::jsonb),
      'anos',  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM anos  WHERE tenant_id = v_tenant), '[]'::jsonb),
      'estilistas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM colaboradores WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL), '[]'::jsonb)
    )
  );

  RETURN v_result;
END;
$$;

-- ============ ESTOQUE ============
CREATE OR REPLACE FUNCTION public.dashboard_estoque()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_total_var int;
  v_total_avi int;
  v_zerados int;
  v_top10 jsonb;
  v_bar jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- Tecidos: estoque por variante (em metros)
  WITH rec AS (
    SELECT it.variante_tecido_id,
           SUM(CASE WHEN a.unidade_medida='kg' THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
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
  -- Aviamentos
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
    (SELECT count(*) FROM all_items WHERE estoque <= 0),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'tipo',tipo,'estoque',estoque) ORDER BY estoque ASC)
              FROM (SELECT id,nome,tipo,estoque FROM all_items ORDER BY estoque ASC LIMIT 10) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'total',total))
              FROM (SELECT categoria, SUM(GREATEST(0,estoque)) AS total FROM tec GROUP BY categoria) c), '[]'::jsonb)
  INTO v_total_var, v_total_avi, v_zerados, v_top10, v_bar;

  RETURN jsonb_build_object(
    'totalVariantes', v_total_var,
    'totalAviamentos', v_total_avi,
    'zerados', v_zerados,
    'top10', v_top10,
    'barData', v_bar
  );
END;
$$;

-- ============ PRODUÇÃO ============
CREATE OR REPLACE FUNCTION public.dashboard_producao()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_timeline jsonb;
  v_sla jsonb;
  v_no_prazo int := 0;
  v_atrasos int := 0;
  v_total int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH c AS (
    SELECT cd.id, cd.modelo_id, m.ref, m.nome,
      EXISTS(SELECT 1 FROM lancamentos l WHERE l.modelo_id = cd.modelo_id) AS lanc,
      EXISTS(SELECT 1 FROM direcionamento d WHERE d.cad_id = cd.id) AS dirc,
      EXISTS(SELECT 1 FROM producao_acabamento a WHERE a.cad_id = cd.id AND a.ativo) AS acab,
      EXISTS(SELECT 1 FROM controle_qualidade q WHERE q.cad_id = cd.id) AS cq,
      EXISTS(SELECT 1 FROM producao_oficina o WHERE o.cad_id = cd.id AND o.data_enviado IS NOT NULL) AS ofic,
      EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = cd.id AND t.ativo) AS terc
    FROM cad cd
    JOIN modelos m ON m.id = cd.modelo_id
    WHERE cd.tenant_id = v_tenant
    ORDER BY m.ref
    LIMIT 200
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'ref', ref, 'nome', nome,
    'etapa', CASE
      WHEN lanc THEN 'Lançado'
      WHEN dirc THEN 'Direcionamento'
      WHEN acab THEN 'Acabamento'
      WHEN cq THEN 'Controle de Qualidade'
      WHEN ofic THEN 'Oficina'
      WHEN terc THEN 'Terceirizado'
      ELSE 'CAD' END
  )), '[]'::jsonb) INTO v_timeline FROM c;

  WITH entregas AS (
    SELECT t.terceirizado_id, t.data_enviado, t.data_prevista, t.data_entregue
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    WHERE t.terceirizado_id IS NOT NULL
    UNION ALL
    SELECT a.terceirizado_id, a.data_enviado, a.data_prevista, a.data_entregue
    FROM producao_acabamento a
    JOIN cad c ON c.id = a.cad_id AND c.tenant_id = v_tenant
    WHERE a.terceirizado_id IS NOT NULL
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'nome', nome, 'slaMedio', slaMedio, 'atrasos', atrasos, 'total', total
    )), '[]'::jsonb)
  INTO v_sla
  FROM (
    SELECT t.nome,
      AVG(EXTRACT(EPOCH FROM (e.data_entregue::timestamp - e.data_enviado::timestamp))/86400)
        FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS slaMedio,
      COUNT(*) FILTER (WHERE e.data_entregue IS NOT NULL AND e.data_prevista IS NOT NULL AND e.data_entregue > e.data_prevista) AS atrasos,
      COUNT(*) FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS total
    FROM entregas e
    JOIN terceirizados t ON t.id = e.terceirizado_id
    GROUP BY t.nome
  ) s;

  WITH entregas2 AS (
    SELECT t.data_prevista, t.data_entregue
    FROM producao_terceirizados t JOIN cad c ON c.id=t.cad_id AND c.tenant_id=v_tenant
    WHERE t.data_entregue IS NOT NULL AND t.data_prevista IS NOT NULL
    UNION ALL
    SELECT a.data_prevista, a.data_entregue
    FROM producao_acabamento a JOIN cad c ON c.id=a.cad_id AND c.tenant_id=v_tenant
    WHERE a.data_entregue IS NOT NULL AND a.data_prevista IS NOT NULL
  )
  SELECT
    count(*) FILTER (WHERE data_entregue <= data_prevista),
    count(*) FILTER (WHERE data_entregue > data_prevista),
    count(*)
  INTO v_no_prazo, v_atrasos, v_total
  FROM entregas2;

  RETURN jsonb_build_object(
    'timeline', v_timeline,
    'slaPorTerc', v_sla,
    'kpiPrazo', jsonb_build_object(
      'noPrazo', v_no_prazo,
      'atrasadas', v_atrasos,
      'pct', CASE WHEN v_total > 0 THEN ROUND((v_no_prazo::numeric/v_total)*100) ELSE 0 END
    )
  );
END;
$$;

-- ============ FINANCEIRO ============
CREATE OR REPLACE FUNCTION public.dashboard_financeiro()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_investido numeric := 0;
  v_pago numeric := 0;
  v_pendente numeric := 0;
  v_chart jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT COALESCE(SUM(valor_real_total),0) INTO v_investido
  FROM ocs_tecido WHERE tenant_id = v_tenant AND status = 'recebido';

  v_investido := v_investido + COALESCE((
    SELECT SUM(COALESCE(i.quantidade_recebida,0) * COALESCE(a.preco,0))
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant AND oc.status = 'recebido'
    LEFT JOIN aviamentos a ON a.id = i.aviamento_id
  ), 0);

  SELECT
    COALESCE(SUM(valor) FILTER (WHERE status='pago' OR data_pagamento IS NOT NULL), 0),
    COALESCE(SUM(valor) FILTER (WHERE NOT(status='pago' OR data_pagamento IS NOT NULL)), 0)
  INTO v_pago, v_pendente
  FROM parcelas WHERE tenant_id = v_tenant;

  WITH meses AS (
    SELECT generate_series(0, 5) AS i
  ),
  base AS (
    SELECT
      to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'YYYY-MM') AS k,
      to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'Mon/YY') AS mes
    FROM meses
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', COALESCE(t.total,0)) ORDER BY k), '[]'::jsonb)
  INTO v_chart
  FROM base
  LEFT JOIN (
    SELECT to_char(data_vencimento, 'YYYY-MM') AS k, SUM(valor) AS total
    FROM parcelas
    WHERE tenant_id = v_tenant
      AND NOT (status='pago' OR data_pagamento IS NOT NULL)
      AND data_vencimento >= date_trunc('month', current_date)
      AND data_vencimento < date_trunc('month', current_date) + interval '6 months'
    GROUP BY 1
  ) t USING (k);

  RETURN jsonb_build_object(
    'investido', v_investido,
    'pago', v_pago,
    'pendente', v_pendente,
    'chartData', v_chart
  );
END;
$$;

-- ============ CUSTOS ============
CREATE OR REPLACE FUNCTION public.dashboard_custos(
  p_colecao text DEFAULT NULL,
  p_mes uuid DEFAULT NULL,
  p_categoria uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rows jsonb;
  v_chart jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH custo_tec AS (
    SELECT ct.cad_id,
      SUM(CASE
        WHEN ct.custo_cad IS NOT NULL THEN ct.custo_cad
        ELSE COALESCE(ct.consumo_cad,0) * (1 + COALESCE(ct.loss_percent_cad,0)/100.0) * COALESCE(a.preco_por_metro,0)
      END) AS total
    FROM cad_tecidos ct
    JOIN cad c ON c.id = ct.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN artigos a ON a.id = ct.artigo_id
    GROUP BY ct.cad_id
  ),
  custo_avi AS (
    SELECT ca.cad_id,
      SUM(COALESCE(ca.quantidade_enviar, ca.consumo, 0) * COALESCE(a.preco, 0)) AS total
    FROM cad_aviamentos ca
    JOIN cad c ON c.id = ca.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN aviamentos a ON a.id = ca.aviamento_id
    GROUP BY ca.cad_id
  ),
  custo_real AS (
    SELECT c.modelo_id,
      COALESCE((SELECT total FROM custo_tec WHERE cad_id = c.id), 0) +
      COALESCE((SELECT total FROM custo_avi WHERE cad_id = c.id), 0) AS total
    FROM cad c WHERE c.tenant_id = v_tenant
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, m.colecao,
      COALESCE(m.custo_peca_previsto, 0) AS previsto,
      COALESCE((SELECT total FROM custo_real WHERE modelo_id = m.id LIMIT 1), 0) AS real
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'ref', ref, 'nome', nome, 'colecao', colecao,
      'previsto', previsto, 'real', real,
      'diff', (real - previsto),
      'pct', CASE WHEN previsto > 0 THEN ((real - previsto)/previsto)*100 ELSE 0 END
    ) ORDER BY ref), '[]'::jsonb)
  INTO v_rows FROM base;

  WITH base AS (
    SELECT m.colecao,
      COALESCE((
        SELECT
          COALESCE((SELECT SUM(CASE WHEN ct.custo_cad IS NOT NULL THEN ct.custo_cad
            ELSE COALESCE(ct.consumo_cad,0) * (1 + COALESCE(ct.loss_percent_cad,0)/100.0) * COALESCE(a.preco_por_metro,0) END)
            FROM cad_tecidos ct LEFT JOIN artigos a ON a.id=ct.artigo_id WHERE ct.cad_id = c.id), 0) +
          COALESCE((SELECT SUM(COALESCE(ca.quantidade_enviar, ca.consumo, 0) * COALESCE(a.preco,0))
            FROM cad_aviamentos ca LEFT JOIN aviamentos a ON a.id=ca.aviamento_id WHERE ca.cad_id = c.id), 0)
        FROM cad c WHERE c.modelo_id = m.id LIMIT 1
      ), 0) AS real
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('colecao', colecao, 'medio', medio)), '[]'::jsonb)
  INTO v_chart
  FROM (
    SELECT colecao, AVG(NULLIF(real,0)) AS medio
    FROM base WHERE colecao IS NOT NULL
    GROUP BY colecao
  ) c;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'chartData', v_chart,
    'filtros', jsonb_build_object(
      'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM meses WHERE tenant_id=v_tenant), '[]'::jsonb),
      'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM categorias_produto WHERE tenant_id=v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id=v_tenant AND colecao IS NOT NULL), '[]'::jsonb)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_colecao(uuid,uuid,int,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_estoque() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_producao() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_financeiro() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_custos(text,uuid,uuid) TO authenticated;
