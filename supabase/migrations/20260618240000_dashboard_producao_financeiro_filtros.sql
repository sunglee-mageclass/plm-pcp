-- Produção: filtros (mês/ano/coleção/linha) + novos painéis
--   cortesPorMes   : por mês-calendário do corte (data_enviado_corte) → nº de modelos e grade total
--   entreguesPorMes: por mês-calendário do lançamento (data_lancamento) → nº de modelos e grade total
--   kanban         : contagem de cads por etapa (para barra horizontal)
-- Financeiro: filtros mês/ano (calendário, sobre data_vencimento das parcelas e data da OC)

-- Remove as versões sem argumentos (senão a chamada sem args fica ambígua
-- entre a 0-arg e a nova com todos os parâmetros DEFAULT).
DROP FUNCTION IF EXISTS public.dashboard_producao();
DROP FUNCTION IF EXISTS public.dashboard_financeiro();

-- ============================ PRODUÇÃO ============================
CREATE OR REPLACE FUNCTION public.dashboard_producao(
  p_mes uuid DEFAULT NULL::uuid,
  p_ano uuid DEFAULT NULL::uuid,
  p_colecao text DEFAULT NULL::text,
  p_linha uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_timeline jsonb;
  v_kanban jsonb;
  v_sla jsonb;
  v_cortes jsonb;
  v_entregues jsonb;
  v_no_prazo int := 0;
  v_atrasos int := 0;
  v_total int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- Timeline (etapa atual por cad) + Kanban (contagem por etapa)
  WITH staged AS (
    SELECT cd.id, m.ref, m.nome,
      CASE
        WHEN EXISTS(SELECT 1 FROM lancamentos l WHERE l.modelo_id = cd.modelo_id) THEN 'Lançado'
        WHEN EXISTS(SELECT 1 FROM direcionamento d WHERE d.cad_id = cd.id) THEN 'Direcionamento'
        WHEN EXISTS(SELECT 1 FROM producao_acabamento a WHERE a.cad_id = cd.id AND a.ativo) THEN 'Acabamento'
        WHEN EXISTS(SELECT 1 FROM controle_qualidade q WHERE q.cad_id = cd.id) THEN 'Controle de Qualidade'
        WHEN EXISTS(SELECT 1 FROM producao_oficina o WHERE o.cad_id = cd.id AND o.data_enviado IS NOT NULL) THEN 'Oficina'
        WHEN EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = cd.id AND t.ativo) THEN 'Terceirizado'
        ELSE 'CAD'
      END AS etapa
    FROM cad cd
    JOIN modelos m ON m.id = cd.modelo_id
    WHERE cd.tenant_id = v_tenant
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'nome', nome, 'etapa', etapa))
              FROM (SELECT id, ref, nome, etapa FROM staged ORDER BY ref LIMIT 200) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_object_agg(etapa, cnt)
              FROM (SELECT etapa, count(*) AS cnt FROM staged GROUP BY etapa) k), '{}'::jsonb)
  INTO v_timeline, v_kanban;

  -- Cortes por mês (mês-calendário de data_enviado_corte)
  WITH cortes AS (
    SELECT cd.id AS cad_id, cd.modelo_id,
      to_char(cd.data_enviado_corte, 'YYYY-MM') AS k,
      to_char(cd.data_enviado_corte, 'Mon/YY') AS mes,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0))
                FROM cad_grades g WHERE g.cad_id = cd.id), 0) AS grade
    FROM cad cd
    JOIN modelos m ON m.id = cd.modelo_id
    WHERE cd.tenant_id = v_tenant
      AND cd.enviado_corte AND cd.data_enviado_corte IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_cortes
  FROM (
    SELECT k, max(mes) AS mes, count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade
    FROM cortes GROUP BY k
  ) x;

  -- Entregues por mês (produção finalizada = lançamentos)
  WITH ent AS (
    SELECT l.modelo_id, l.cad_id,
      to_char(l.data_lancamento, 'YYYY-MM') AS k,
      to_char(l.data_lancamento, 'Mon/YY') AS mes,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0))
                FROM cad_grades g WHERE g.cad_id = l.cad_id), 0) AS grade
    FROM lancamentos l
    JOIN modelos m ON m.id = l.modelo_id
    WHERE l.tenant_id = v_tenant AND l.data_lancamento IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_entregues
  FROM (
    SELECT k, max(mes) AS mes, count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade
    FROM ent GROUP BY k
  ) y;

  -- SLA por terceirizado (entregas de terceirizados + acabamento), respeitando filtros do modelo
  WITH entregas AS (
    SELECT t.terceirizado_id, t.data_enviado, t.data_prevista, t.data_entregue,
           COALESCE(t.quantidade_recebida,0) AS qrec, COALESCE(t.quantidade_defeito,0) AS qdef
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE t.terceirizado_id IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    UNION ALL
    SELECT a.terceirizado_id, a.data_enviado, a.data_prevista, a.data_entregue,
           0::int AS qrec, 0::int AS qdef
    FROM producao_acabamento a
    JOIN cad c ON c.id = a.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE a.terceirizado_id IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'nome', nome, 'slaMedio', slaMedio, 'atrasos', atrasos, 'total', total,
      'pecasProduzidas', pecasProduzidas, 'pecasDefeito', pecasDefeito,
      'taxaDefeito', CASE WHEN pecasProduzidas > 0 THEN ROUND((pecasDefeito::numeric / pecasProduzidas) * 100, 2) ELSE 0 END
    )), '[]'::jsonb)
  INTO v_sla
  FROM (
    SELECT t.nome_responsavel AS nome,
      AVG(EXTRACT(EPOCH FROM (e.data_entregue::timestamp - e.data_enviado::timestamp))/86400)
        FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS slaMedio,
      COUNT(*) FILTER (WHERE e.data_entregue IS NOT NULL AND e.data_prevista IS NOT NULL AND e.data_entregue > e.data_prevista) AS atrasos,
      COUNT(*) FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS total,
      SUM(e.qrec) AS pecasProduzidas,
      SUM(e.qdef) AS pecasDefeito
    FROM entregas e
    JOIN terceirizados t ON t.id = e.terceirizado_id
    GROUP BY t.nome_responsavel
  ) s;

  -- KPI prazo (entregas), respeitando filtros
  WITH entregas2 AS (
    SELECT t.data_prevista, t.data_entregue
    FROM producao_terceirizados t
    JOIN cad c ON c.id=t.cad_id AND c.tenant_id=v_tenant
    JOIN modelos m ON m.id=c.modelo_id
    WHERE t.data_entregue IS NOT NULL AND t.data_prevista IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    UNION ALL
    SELECT a.data_prevista, a.data_entregue
    FROM producao_acabamento a
    JOIN cad c ON c.id=a.cad_id AND c.tenant_id=v_tenant
    JOIN modelos m ON m.id=c.modelo_id
    WHERE a.data_entregue IS NOT NULL AND a.data_prevista IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT
    count(*) FILTER (WHERE data_entregue <= data_prevista),
    count(*) FILTER (WHERE data_entregue > data_prevista),
    count(*)
  INTO v_no_prazo, v_atrasos, v_total
  FROM entregas2;

  RETURN jsonb_build_object(
    'timeline', v_timeline,
    'kanban', v_kanban,
    'cortesPorMes', v_cortes,
    'entreguesPorMes', v_entregues,
    'slaPorTerc', v_sla,
    'kpiPrazo', jsonb_build_object(
      'noPrazo', v_no_prazo,
      'atrasadas', v_atrasos,
      'pct', CASE WHEN v_total > 0 THEN ROUND((v_no_prazo::numeric/v_total)*100) ELSE 0 END
    ),
    'filtros', jsonb_build_object(
      'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome', CASE WHEN mes LIKE '%|%' THEN split_part(mes,'|',2) ELSE mes END) ORDER BY mes) FROM meses WHERE tenant_id = v_tenant), '[]'::jsonb),
      'anos',  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',ano) ORDER BY ano) FROM anos WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb)
    )
  );
END;
$function$;


-- ============================ FINANCEIRO ============================
CREATE OR REPLACE FUNCTION public.dashboard_financeiro(
  p_ano integer DEFAULT NULL::integer,
  p_mes integer DEFAULT NULL::integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_investido numeric := 0;
  v_pago numeric := 0;
  v_pendente numeric := 0;
  v_chart jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- Investido em matéria-prima (OCs recebidas), filtrável por ano/mês da data da OC
  SELECT COALESCE(SUM(valor_real_total),0) INTO v_investido
  FROM ocs_tecido
  WHERE tenant_id = v_tenant AND status = 'recebido'
    AND (p_ano IS NULL OR EXTRACT(YEAR FROM COALESCE(data_entrega, data_pedido)) = p_ano)
    AND (p_mes IS NULL OR EXTRACT(MONTH FROM COALESCE(data_entrega, data_pedido)) = p_mes);

  v_investido := v_investido + COALESCE((
    SELECT SUM(COALESCE(i.quantidade_recebida,0) * COALESCE(a.preco,0))
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant AND oc.status = 'recebido'
      AND (p_ano IS NULL OR EXTRACT(YEAR FROM COALESCE(oc.data_entrega, oc.data_pedido)) = p_ano)
      AND (p_mes IS NULL OR EXTRACT(MONTH FROM COALESCE(oc.data_entrega, oc.data_pedido)) = p_mes)
    LEFT JOIN aviamentos a ON a.id = i.aviamento_id
  ), 0);

  -- Pago / pendente das parcelas, filtrável por ano/mês do vencimento
  SELECT
    COALESCE(SUM(valor) FILTER (WHERE status='pago' OR data_pagamento IS NOT NULL), 0),
    COALESCE(SUM(valor) FILTER (WHERE NOT(status='pago' OR data_pagamento IS NOT NULL)), 0)
  INTO v_pago, v_pendente
  FROM parcelas
  WHERE tenant_id = v_tenant
    AND (p_ano IS NULL OR EXTRACT(YEAR FROM data_vencimento) = p_ano)
    AND (p_mes IS NULL OR EXTRACT(MONTH FROM data_vencimento) = p_mes);

  -- Gráfico: se um ano foi escolhido, mostra os 12 meses dele; senão, próximos 6 meses
  IF p_ano IS NOT NULL THEN
    WITH meses AS (SELECT generate_series(1, 12) AS m),
    base AS (
      SELECT to_char(make_date(p_ano, m, 1), 'YYYY-MM') AS k,
             to_char(make_date(p_ano, m, 1), 'Mon/YY') AS mes
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
        AND EXTRACT(YEAR FROM data_vencimento) = p_ano
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
      SELECT to_char(data_vencimento, 'YYYY-MM') AS k, SUM(valor) AS total
      FROM parcelas
      WHERE tenant_id = v_tenant
        AND NOT (status='pago' OR data_pagamento IS NOT NULL)
        AND data_vencimento >= date_trunc('month', current_date)
        AND data_vencimento < date_trunc('month', current_date) + interval '6 months'
      GROUP BY 1
    ) t USING (k);
  END IF;

  RETURN jsonb_build_object(
    'investido', v_investido,
    'pago', v_pago,
    'pendente', v_pendente,
    'chartData', v_chart,
    'filtros', jsonb_build_object(
      'anos', COALESCE((
        SELECT jsonb_agg(DISTINCT y ORDER BY y) FROM (
          SELECT EXTRACT(YEAR FROM data_vencimento)::int AS y FROM parcelas WHERE tenant_id = v_tenant AND data_vencimento IS NOT NULL
        ) z
      ), '[]'::jsonb)
    )
  );
END;
$function$;
