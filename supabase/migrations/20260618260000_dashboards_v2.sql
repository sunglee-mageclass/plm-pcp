-- Dashboards v2 — semântica corrigida + novos painéis.
--   colecao    : KPIs por estágio (partição limpa); "lançado" = enviado_cad +
--                CQ confirmado (mesma condição que faz aparecer em Lançamentos).
--   producao   : cortes por mês (data entregue do corte), produção finalizada
--                (Serviços/terceirizado status=finalizado), kanban do
--                DESENVOLVIMENTO (por modelo e por grade), timeline com versão.
--   custos     : custo real por PEÇA (compara com o previsto unitário).
--   financeiro : filtro por PERÍODO (intervalo de datas).

DROP FUNCTION IF EXISTS public.dashboard_financeiro(integer, integer);

-- ============================ COLEÇÃO ============================
CREATE OR REPLACE FUNCTION public.dashboard_colecao(p_mes uuid DEFAULT NULL::uuid, p_ano uuid DEFAULT NULL::uuid, p_semana integer DEFAULT NULL::integer, p_colecao text DEFAULT NULL::text, p_estilista uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_result jsonb;
  v_total int := 0; v_planej int := 0; v_desenv int := 0; v_prod int := 0; v_lanc int := 0;
  v_reach_dev int := 0; v_reach_prod int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH m AS (
    SELECT mo.id, mo.status_planejamento AS sp, COALESCE(mo.enviado_cad, false) AS ec,
           EXISTS(SELECT 1 FROM cad c JOIN controle_qualidade q ON q.cad_id = c.id
                  WHERE c.modelo_id = mo.id AND q.status = 'confirmado') AS lanc
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_mes IS NULL OR mo.mes_id = p_mes)
      AND (p_ano IS NULL OR mo.ano_id = p_ano)
      AND (p_semana IS NULL OR mo.semana = p_semana::text)
      AND (p_colecao IS NULL OR mo.colecao = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE NOT ec AND sp IS DISTINCT FROM 'planejado'),   -- em planejamento
    count(*) FILTER (WHERE NOT ec AND sp = 'planejado'),                  -- em desenvolvimento
    count(*) FILTER (WHERE ec AND NOT lanc),                              -- em produção
    count(*) FILTER (WHERE ec AND lanc),                                  -- lançados
    count(*) FILTER (WHERE ec OR sp = 'planejado'),                       -- alcançou desenvolvimento+
    count(*) FILTER (WHERE ec)                                            -- alcançou produção+
  INTO v_total, v_planej, v_desenv, v_prod, v_lanc, v_reach_dev, v_reach_prod
  FROM m;

  v_result := jsonb_build_object(
    'kpis', jsonb_build_object(
      'total', v_total, 'planejamento', v_planej, 'desenvolvimento', v_desenv,
      'producao', v_prod, 'lancados', v_lanc
    ),
    'funnel', jsonb_build_array(
      jsonb_build_object('name','Total',           'value', v_total),
      jsonb_build_object('name','Desenvolvimento', 'value', v_reach_dev),
      jsonb_build_object('name','Produção',        'value', v_reach_prod),
      jsonb_build_object('name','Lançados',        'value', v_lanc)
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
          AND (p_semana IS NULL OR mo.semana = p_semana::text)
          AND (p_colecao IS NULL OR mo.colecao = p_colecao)
          AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
        GROUP BY 1
      ) x
    ), '[]'::jsonb),
    'filtros', jsonb_build_object(
      'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome', CASE WHEN mes LIKE '%|%' THEN split_part(mes,'|',2) ELSE mes END) ORDER BY mes) FROM meses WHERE tenant_id = v_tenant), '[]'::jsonb),
      'anos',  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',ano) ORDER BY ano) FROM anos  WHERE tenant_id = v_tenant), '[]'::jsonb),
      'estilistas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM colaboradores WHERE tenant_id = v_tenant AND tipo = 'estilista'), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL), '[]'::jsonb)
    )
  );
  RETURN v_result;
END;
$function$;


-- ============================ PRODUÇÃO ============================
CREATE OR REPLACE FUNCTION public.dashboard_producao(
  p_mes uuid DEFAULT NULL::uuid, p_ano uuid DEFAULT NULL::uuid,
  p_colecao text DEFAULT NULL::text, p_linha uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_timeline jsonb; v_kanban jsonb; v_sla jsonb; v_cortes jsonb; v_finalizadas jsonb;
  v_no_prazo int := 0; v_atrasos int := 0; v_total int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- Timeline (etapa de produção atual por cad) com versão do modelo
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'nome', nome, 'versao', versao, 'etapa', etapa)
                  ORDER BY ref), '[]'::jsonb)
  INTO v_timeline
  FROM (
    SELECT cd.id, m.ref, m.nome, m.versao,
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
    ORDER BY m.ref
    LIMIT 200
  ) t;

  -- Kanban do DESENVOLVIMENTO (colunas de tenant_config.status_kanban; fallback DEFAULT).
  -- Bucketiza status_desenvolvimento casando com a key da coluna OU com a key
  -- canônica (snake) cujo label DEFAULT bate com o label da coluna; o resto cai na 1ª.
  WITH defmap(dkey, dlabel) AS (VALUES
    ('em_modelagem','Em Modelagem'),
    ('corte_piloto_1','Corte de Piloto I'),
    ('corte_piloto_2','Corte de Piloto II'),
    ('corte_piloto_3','Corte de Piloto III'),
    ('em_pilotagem','Em Pilotagem'),
    ('prova_roupa_1','Prova de Roupa I'),
    ('prova_roupa_2','Prova de Roupa II'),
    ('prova_roupa_3','Prova de Roupa III'),
    ('prova_roupa_4','Prova de Roupa IV'),
    ('prova_roupa_5','Prova de Roupa V'),
    ('em_ajuste','Em Ajuste'),
    ('stand_by','Stand By'),
    ('reprovado','Reprovado'),
    ('aprovado','Aprovado')
  ),
  sk AS (
    SELECT COALESCE(
      (SELECT tc.status_kanban FROM tenant_config tc
         WHERE tc.tenant_id = v_tenant
           AND jsonb_typeof(tc.status_kanban) = 'array'
           AND jsonb_array_length(tc.status_kanban) > 0),
      (SELECT jsonb_agg(jsonb_build_object('key',dkey,'label',dlabel)) FROM defmap)
    ) AS arr
  ),
  cols AS (
    SELECT t.ord,
      CASE jsonb_typeof(t.e) WHEN 'string' THEN (t.e #>> '{}')
        ELSE COALESCE(t.e->>'key', t.e->>'id', t.e->>'value', t.e->>'slug', 's'||t.ord::text) END AS key,
      CASE jsonb_typeof(t.e) WHEN 'string' THEN (t.e #>> '{}')
        ELSE COALESCE(t.e->>'label', t.e->>'nome', t.e->>'name', t.e->>'key', 's'||t.ord::text) END AS label
    FROM sk, LATERAL jsonb_array_elements(sk.arr) WITH ORDINALITY AS t(e, ord)
  ),
  cols2 AS (
    SELECT c.ord, c.key, c.label,
      (SELECT d.dkey FROM defmap d WHERE d.dlabel = c.label LIMIT 1) AS alias_key
    FROM cols c
  ),
  firstcol AS (SELECT key FROM cols2 ORDER BY ord LIMIT 1),
  mods AS (
    SELECT m.id,
      COALESCE(
        (SELECT c.key FROM cols2 c
           WHERE c.key = m.status_desenvolvimento OR c.alias_key = m.status_desenvolvimento
           ORDER BY c.ord LIMIT 1),
        (SELECT key FROM firstcol)
      ) AS bucket,
      COALESCE((SELECT SUM(COALESCE(mg.grade_total,0)) FROM modelo_grades mg WHERE mg.modelo_id = m.id), 0) AS grade
    FROM modelos m
    WHERE m.tenant_id = v_tenant AND m.status_planejamento = 'planejado'
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  ),
  agg AS (SELECT bucket, count(*) AS modelos, SUM(grade) AS grade FROM mods GROUP BY bucket)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'key', c.key, 'label', c.label,
           'modelos', COALESCE(a.modelos,0), 'grade', COALESCE(a.grade,0)) ORDER BY c.ord), '[]'::jsonb)
  INTO v_kanban
  FROM cols2 c LEFT JOIN agg a ON a.bucket = c.key;

  -- Cortes por mês (data entregue do corte = data_corte_pronto; fallback data_enviado_corte)
  WITH cortes AS (
    SELECT cd.modelo_id,
      to_char(COALESCE(cd.data_corte_pronto, cd.data_enviado_corte), 'YYYY-MM') AS k,
      to_char(COALESCE(cd.data_corte_pronto, cd.data_enviado_corte), 'Mon/YY') AS mes,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = cd.id), 0) AS grade
    FROM cad cd JOIN modelos m ON m.id = cd.modelo_id
    WHERE cd.tenant_id = v_tenant
      AND COALESCE(cd.data_corte_pronto, cd.data_enviado_corte) IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_cortes
  FROM (SELECT k, max(mes) AS mes, count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade FROM cortes GROUP BY k) x;

  -- Produção finalizada por mês (cad com Serviço/terceirizado status=finalizado;
  -- mês = última data_entregue finalizada)
  WITH fin AS (
    SELECT c.modelo_id,
      (SELECT max(t.data_entregue) FROM producao_terceirizados t
         WHERE t.cad_id = c.id AND t.status = 'finalizado' AND t.data_entregue IS NOT NULL) AS dt,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = c.id), 0) AS grade
    FROM cad c JOIN modelos m ON m.id = c.modelo_id
    WHERE c.tenant_id = v_tenant
      AND EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.status = 'finalizado')
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_finalizadas
  FROM (
    SELECT to_char(dt,'YYYY-MM') AS k, to_char(dt,'Mon/YY') AS mes,
           count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade
    FROM fin WHERE dt IS NOT NULL
    GROUP BY 1, 2
  ) y;

  -- SLA por terceirizado, respeitando filtros do modelo
  WITH entregas AS (
    SELECT t.terceirizado_id, t.data_enviado, t.data_prevista, t.data_entregue,
           COALESCE(t.quantidade_recebida,0) AS qrec, COALESCE(t.quantidade_defeito,0) AS qdef
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE t.terceirizado_id IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes) AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
    UNION ALL
    SELECT a.terceirizado_id, a.data_enviado, a.data_prevista, a.data_entregue, 0::int, 0::int
    FROM producao_acabamento a
    JOIN cad c ON c.id = a.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE a.terceirizado_id IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes) AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
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
      SUM(e.qrec) AS pecasProduzidas, SUM(e.qdef) AS pecasDefeito
    FROM entregas e JOIN terceirizados t ON t.id = e.terceirizado_id
    GROUP BY t.nome_responsavel
  ) s;

  -- KPI prazo
  WITH entregas2 AS (
    SELECT t.data_prevista, t.data_entregue
    FROM producao_terceirizados t JOIN cad c ON c.id=t.cad_id AND c.tenant_id=v_tenant JOIN modelos m ON m.id=c.modelo_id
    WHERE t.data_entregue IS NOT NULL AND t.data_prevista IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes) AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
    UNION ALL
    SELECT a.data_prevista, a.data_entregue
    FROM producao_acabamento a JOIN cad c ON c.id=a.cad_id AND c.tenant_id=v_tenant JOIN modelos m ON m.id=c.modelo_id
    WHERE a.data_entregue IS NOT NULL AND a.data_prevista IS NOT NULL
      AND (p_mes IS NULL OR m.mes_id = p_mes) AND (p_ano IS NULL OR m.ano_id = p_ano)
      AND (p_colecao IS NULL OR m.colecao = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT count(*) FILTER (WHERE data_entregue <= data_prevista),
         count(*) FILTER (WHERE data_entregue > data_prevista), count(*)
  INTO v_no_prazo, v_atrasos, v_total FROM entregas2;

  RETURN jsonb_build_object(
    'timeline', v_timeline,
    'kanbanDev', v_kanban,
    'cortesPorMes', v_cortes,
    'finalizadasPorMes', v_finalizadas,
    'slaPorTerc', v_sla,
    'kpiPrazo', jsonb_build_object('noPrazo', v_no_prazo, 'atrasadas', v_atrasos,
      'pct', CASE WHEN v_total > 0 THEN ROUND((v_no_prazo::numeric/v_total)*100) ELSE 0 END),
    'filtros', jsonb_build_object(
      'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome', CASE WHEN mes LIKE '%|%' THEN split_part(mes,'|',2) ELSE mes END) ORDER BY mes) FROM meses WHERE tenant_id = v_tenant), '[]'::jsonb),
      'anos',  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',ano) ORDER BY ano) FROM anos WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb)
    )
  );
END;
$function$;


-- ============================ CUSTOS ============================
CREATE OR REPLACE FUNCTION public.dashboard_custos(p_colecao text DEFAULT NULL::text, p_mes uuid DEFAULT NULL::uuid, p_categoria uuid DEFAULT NULL::uuid)
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

  WITH custo_por_cad AS (
    SELECT c.id AS cad_id, c.modelo_id,
      COALESCE((
        SELECT SUM(CASE WHEN ct.custo_cad IS NOT NULL THEN ct.custo_cad
          ELSE COALESCE(ct.consumo_cad,0) * (1 + COALESCE(ct.loss_percent_cad,0)/100.0) * COALESCE(a.preco_por_metro,0) END)
        FROM cad_tecidos ct LEFT JOIN artigos a ON a.id = ct.artigo_id WHERE ct.cad_id = c.id), 0)
      + COALESCE((
        SELECT SUM(COALESCE(ca.quantidade_enviar, ca.consumo, 0) * COALESCE(a.preco, 0))
        FROM cad_aviamentos ca LEFT JOIN aviamentos a ON a.id = ca.aviamento_id WHERE ca.cad_id = c.id), 0) AS total,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = c.id), 0) AS pecas
    FROM cad c WHERE c.tenant_id = v_tenant
  ),
  custo_real AS (
    SELECT modelo_id, SUM(total) AS total, SUM(pecas) AS pecas
    FROM custo_por_cad GROUP BY modelo_id
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, m.colecao, m.versao,
      EXISTS(SELECT 1 FROM cad c WHERE c.modelo_id = m.id) AS tem_cad,
      COALESCE(m.custo_peca_previsto, 0) AS previsto,
      COALESCE((SELECT CASE WHEN cr.pecas > 0 THEN cr.total / cr.pecas ELSE cr.total END
                FROM custo_real cr WHERE cr.modelo_id = m.id), 0) AS real
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_mes IS NULL OR m.mes_id = p_mes)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'ref', ref, 'nome', nome, 'colecao', colecao, 'versao', versao,
        'previsto', previsto, 'real', real, 'diff', (real - previsto),
        'pct', CASE WHEN previsto > 0 THEN ((real - previsto)/previsto)*100 ELSE 0 END
      ) ORDER BY ref) FROM base), '[]'::jsonb),
    -- Custo médio por peça por coleção: só modelos que já chegaram ao CAD.
    COALESCE((SELECT jsonb_agg(jsonb_build_object('colecao', colecao, 'medio', medio))
              FROM (SELECT colecao, AVG(NULLIF(real,0)) AS medio FROM base WHERE colecao IS NOT NULL AND tem_cad GROUP BY colecao) c), '[]'::jsonb)
  INTO v_rows, v_chart;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'chartData', v_chart,
    'filtros', jsonb_build_object(
      'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome', CASE WHEN mes LIKE '%|%' THEN split_part(mes,'|',2) ELSE mes END) ORDER BY mes) FROM meses WHERE tenant_id=v_tenant), '[]'::jsonb),
      'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM categorias_produto WHERE tenant_id=v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id=v_tenant AND colecao IS NOT NULL), '[]'::jsonb)
    )
  );
END;
$function$;


-- ============================ FINANCEIRO ============================
CREATE OR REPLACE FUNCTION public.dashboard_financeiro(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_investido numeric := 0; v_pago numeric := 0; v_pendente numeric := 0;
  v_chart jsonb;
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
  ), 0);

  SELECT
    COALESCE(SUM(valor) FILTER (WHERE status='pago' OR data_pagamento IS NOT NULL), 0),
    COALESCE(SUM(valor) FILTER (WHERE NOT(status='pago' OR data_pagamento IS NOT NULL)), 0)
  INTO v_pago, v_pendente
  FROM parcelas
  WHERE tenant_id = v_tenant
    AND (p_inicio IS NULL OR data_vencimento >= p_inicio)
    AND (p_fim    IS NULL OR data_vencimento <= p_fim);

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

  RETURN jsonb_build_object(
    'investido', v_investido, 'pago', v_pago, 'pendente', v_pendente, 'chartData', v_chart
  );
END;
$function$;
