-- Dashboard — correctness do time (jul/2026). Tela sólida/segura; estes são fixes
-- de corretude semântica (decisões do dono):
-- 1) Coleção "Lançados"/"Em Produção": usa modelos.lancado (fonte única, invariante #6)
--    em vez de "CQ Pré confirmado" — alinha com a timeline de Produção (era divergente).
-- 2) "Estoque em R$ parado": baixa vem do ledger canônico estoque_tecido_baixas
--    (invariante #4), não de cad_tecido_variantes.metragem_enviada (ignorava separacao_rolo).
-- 3) Financeiro "Total pago": por data_pagamento (fluxo de caixa), não data_vencimento;
--    investido de aviamento passa a ignorar item cancelado.
-- 4) Custos: chartData de média por coleção agora traz nConf/nTotal (cobertura) — a média
--    só conta modelos com corte confirmado, então mostrar N/Total evita enganar.
-- 5) #9: REVOKE EXECUTE de ranking_oficinas de PUBLIC/anon (único wrapper que faltava).
--
-- Testado em txn revertida: as 5 RPCs rodam, colecao lancados=modelos.lancado,
-- estoque_parado bate com o ledger, pago por data_pagamento, custos com cobertura.

BEGIN;

CREATE OR REPLACE FUNCTION public._dashboard_colecao_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_estilista uuid DEFAULT NULL::uuid, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_total int := 0; v_planej int := 0; v_desenv int := 0; v_prod int := 0; v_lanc int := 0;
  v_reach_dev int := 0; v_reach_prod int := 0; v_pie jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH mods AS (
    SELECT mo.id, mo.status_planejamento AS sp, COALESCE(mo.enviado_cad, false) AS ec,
           mo.categoria_principal_id AS cat,
           COALESCE(mo.lancado, false) AS lanc
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_colecao IS NULL OR mo.colecao = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
      AND (p_linha IS NULL OR mo.linha_id = p_linha)
      AND public._modelo_no_periodo(mo.mes_id, mo.ano_id, p_inicio, p_fim)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE NOT ec AND sp IS DISTINCT FROM 'planejado'),
    count(*) FILTER (WHERE NOT ec AND sp = 'planejado'),
    count(*) FILTER (WHERE ec AND NOT lanc),
    count(*) FILTER (WHERE ec AND lanc),
    count(*) FILTER (WHERE ec OR sp = 'planejado'),
    count(*) FILTER (WHERE ec),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', nome, 'value', total))
              FROM (SELECT COALESCE(cp.nome,'Sem categoria') AS nome, count(*) AS total
                    FROM mods LEFT JOIN categorias_produto cp ON cp.id = mods.cat GROUP BY 1) x), '[]'::jsonb)
  INTO v_total, v_planej, v_desenv, v_prod, v_lanc, v_reach_dev, v_reach_prod, v_pie
  FROM mods;

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object('total', v_total, 'planejamento', v_planej, 'desenvolvimento', v_desenv, 'producao', v_prod, 'lancados', v_lanc),
    'funnel', jsonb_build_array(
      jsonb_build_object('name','Total','value', v_total),
      jsonb_build_object('name','Desenvolvimento','value', v_reach_dev),
      jsonb_build_object('name','Produção','value', v_reach_prod),
      jsonb_build_object('name','Lançados','value', v_lanc)
    ),
    'pie', v_pie,
    'filtros', jsonb_build_object(
      'estilistas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM colaboradores WHERE tenant_id = v_tenant AND tipo = 'estilista'), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL AND colecao <> ''), '[]'::jsonb)
    )
  );
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
    -- Baixa SEMPRE do ledger canônico (invariante #4): captura corte, ajuste e
    -- separacao_rolo. Antes usava cad_tecido_variantes.metragem_enviada, que ignora
    -- separacao_rolo e diverge material do físico real.
    SELECT vt.artigo_id, SUM(COALESCE(b.quantidade, 0)) AS m
    FROM public.estoque_tecido_baixas b
    JOIN public.variantes_tecido vt ON vt.id = b.variante_tecido_id
    WHERE b.tenant_id = v_tenant
      AND vt.artigo_id IS NOT NULL
    GROUP BY vt.artigo_id
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

CREATE OR REPLACE FUNCTION public._dashboard_financeiro_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_investido numeric := 0; v_pago numeric := 0; v_pendente numeric := 0;
  v_chart jsonb; v_aging jsonb; v_top_forn jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT COALESCE(SUM(valor_real_total),0) INTO v_investido
  FROM ocs_tecido
  WHERE tenant_id = v_tenant AND status = 'recebido'
    AND (p_inicio IS NULL OR COALESCE(data_entrega, data_pedido) >= p_inicio)
    AND (p_fim    IS NULL OR COALESCE(data_entrega, data_pedido) <= p_fim);

  v_investido := v_investido + COALESCE((
    SELECT SUM(COALESCE(i.quantidade_recebida,0) * COALESCE(a.preco,0))
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant AND oc.status = 'recebido'
      AND (p_inicio IS NULL OR COALESCE(oc.data_entrega, oc.data_pedido) >= p_inicio)
      AND (p_fim    IS NULL OR COALESCE(oc.data_entrega, oc.data_pedido) <= p_fim)
    LEFT JOIN aviamentos a ON a.id = i.aviamento_id
    WHERE COALESCE(i.cancelado, false) = false
  ), 0);

  -- Pendente (a pagar): por VENCIMENTO no período.
  SELECT COALESCE(SUM(valor) FILTER (WHERE NOT(status='pago' OR data_pagamento IS NOT NULL)), 0)
  INTO v_pendente
  FROM parcelas
  WHERE tenant_id = v_tenant
    AND (p_inicio IS NULL OR data_vencimento >= p_inicio)
    AND (p_fim    IS NULL OR data_vencimento <= p_fim);

  -- Pago: por DATA DE PAGAMENTO no período (fluxo de caixa real, não vencimento).
  SELECT COALESCE(SUM(valor), 0)
  INTO v_pago
  FROM parcelas
  WHERE tenant_id = v_tenant AND (status='pago' OR data_pagamento IS NOT NULL)
    AND (p_inicio IS NULL OR data_pagamento >= p_inicio)
    AND (p_fim    IS NULL OR data_pagamento <= p_fim);

  IF p_inicio IS NOT NULL AND p_fim IS NOT NULL THEN
    WITH gs AS (
      SELECT generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') AS d
    ),
    base AS (SELECT to_char(d,'YYYY-MM') AS k, to_char(d,'Mon/YY') AS mes FROM gs)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', COALESCE(t.total,0)) ORDER BY k), '[]'::jsonb)
    INTO v_chart
    FROM base
    LEFT JOIN (
      SELECT to_char(data_vencimento,'YYYY-MM') AS k, SUM(valor) AS total
      FROM parcelas
      WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
        AND data_vencimento >= date_trunc('month', p_inicio)
        AND data_vencimento <  date_trunc('month', p_fim) + interval '1 month'
      GROUP BY 1
    ) t USING (k);
  ELSE
    WITH meses AS (SELECT generate_series(0, 5) AS i),
    base AS (
      SELECT to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'YYYY-MM') AS k,
             to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'Mon/YY') AS mes
      FROM meses
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', COALESCE(t.total,0)) ORDER BY k), '[]'::jsonb)
    INTO v_chart
    FROM base
    LEFT JOIN (
      SELECT to_char(data_vencimento,'YYYY-MM') AS k, SUM(valor) AS total
      FROM parcelas
      WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
        AND data_vencimento >= date_trunc('month', current_date)
        AND data_vencimento <  date_trunc('month', current_date) + interval '6 months'
      GROUP BY 1
    ) t USING (k);
  END IF;

  -- Aging das contas a pagar EM ABERTO (snapshot atual, por idade do vencimento).
  v_aging := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('faixa', faixa, 'total', total) ORDER BY ord)
    FROM (
      SELECT faixa, ord, SUM(valor) AS total FROM (
        SELECT valor,
          CASE WHEN data_vencimento < current_date THEN 'Vencido'
               WHEN data_vencimento <= current_date + 30 THEN '0–30 dias'
               WHEN data_vencimento <= current_date + 60 THEN '31–60 dias'
               WHEN data_vencimento <= current_date + 90 THEN '61–90 dias'
               ELSE '90+ dias' END AS faixa,
          CASE WHEN data_vencimento < current_date THEN 0
               WHEN data_vencimento <= current_date + 30 THEN 1
               WHEN data_vencimento <= current_date + 60 THEN 2
               WHEN data_vencimento <= current_date + 90 THEN 3
               ELSE 4 END AS ord
        FROM parcelas
        WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
      ) x GROUP BY faixa, ord
    ) a
  ), '[]'::jsonb);

  -- Top fornecedores por valor das parcelas no período.
  v_top_forn := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('nome', nome, 'total', total) ORDER BY total DESC)
    FROM (
      SELECT COALESCE(e.nome_fantasia, 'Sem fornecedor') AS nome, SUM(p.valor) AS total
      FROM parcelas p
      LEFT JOIN empresas e ON e.id = p.empresa_id
      WHERE p.tenant_id = v_tenant
        AND (p_inicio IS NULL OR p.data_vencimento >= p_inicio)
        AND (p_fim    IS NULL OR p.data_vencimento <= p_fim)
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 8
    ) f
  ), '[]'::jsonb);

  RETURN jsonb_build_object(
    'investido', v_investido, 'pago', v_pago, 'pendente', v_pendente, 'chartData', v_chart,
    'aging', v_aging, 'topFornecedores', v_top_forn
  );
END;
$function$

;

CREATE OR REPLACE FUNCTION public._dashboard_custos_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_categoria uuid DEFAULT NULL::uuid, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rows jsonb; v_chart jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH cad_conf AS (
    SELECT DISTINCT ON (c.modelo_id) c.modelo_id, c.id AS cad_id
    FROM cad c
    WHERE c.tenant_id = v_tenant AND c.enviado_corte
    ORDER BY c.modelo_id, c.data_enviado_corte DESC NULLS LAST
  ),
  mat AS (
    SELECT cc.modelo_id,
      COALESCE((SELECT SUM(CASE WHEN ct.custo_cad IS NOT NULL THEN ct.custo_cad
          ELSE COALESCE(ct.consumo_cad,0) * (1 + COALESCE(ct.loss_percent_cad,0)/100.0) * COALESCE(a.preco_por_metro,0) END)
        FROM cad_tecidos ct LEFT JOIN artigos a ON a.id = ct.artigo_id WHERE ct.cad_id = cc.cad_id), 0)
      + COALESCE((SELECT SUM(COALESCE(ca.consumo,0) * COALESCE(av.preco,0))
        FROM cad_aviamentos ca LEFT JOIN aviamentos av ON av.id = ca.aviamento_id WHERE ca.cad_id = cc.cad_id), 0) AS materials,
      COALESCE((SELECT SUM(COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)
            - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0))
        FROM producao_terceirizados pt WHERE pt.cad_id = cc.cad_id AND COALESCE(pt.interno,false) = false), 0) AS servico_total,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = cc.cad_id), 0) AS grade
    FROM cad_conf cc
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, m.colecao, m.versao,
      EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id) AS confirmado,
      COALESCE(m.custo_peca_previsto, 0) AS previsto,
      CASE WHEN EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id)
        THEN COALESCE((SELECT materials + CASE WHEN grade > 0 THEN servico_total / grade ELSE 0 END
                       FROM mat WHERE mat.modelo_id = m.id), 0)
        ELSE COALESCE(m.custo_peca_previsto, 0)
      END AS real
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'ref', ref, 'nome', nome, 'colecao', colecao, 'versao', versao, 'confirmado', confirmado,
        'previsto', previsto, 'real', real, 'diff', (real - previsto),
        'pct', CASE WHEN previsto > 0 THEN ((real - previsto)/previsto)*100 ELSE 0 END
      ) ORDER BY ref) FROM base), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('colecao', colecao, 'medio', medio, 'nConf', n_conf, 'nTotal', n_total))
              FROM (SELECT colecao, AVG(NULLIF(real,0)) FILTER (WHERE confirmado) AS medio,
                           COUNT(*) FILTER (WHERE confirmado) AS n_conf, COUNT(*) AS n_total
                    FROM base WHERE colecao IS NOT NULL GROUP BY colecao
                    HAVING COUNT(*) FILTER (WHERE confirmado) > 0) c), '[]'::jsonb)
  INTO v_rows, v_chart;

  RETURN jsonb_build_object(
    'rows', v_rows, 'chartData', v_chart,
    'filtros', jsonb_build_object(
      'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM categorias_produto WHERE tenant_id=v_tenant), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id=v_tenant AND colecao IS NOT NULL AND colecao <> ''), '[]'::jsonb)
    )
  );
END;
$function$

;

-- #9: alinhar ranking_oficinas ao padrão dos demais wrappers (só authenticated).
REVOKE EXECUTE ON FUNCTION public.ranking_oficinas(uuid) FROM PUBLIC, anon;

COMMIT;
