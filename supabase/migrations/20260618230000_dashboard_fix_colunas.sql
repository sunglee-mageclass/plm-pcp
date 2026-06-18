-- Corrige as 3 RPCs de dashboard que estavam quebradas por colunas inexistentes
-- após mudanças de schema:
--   dashboard_colecao   : modelos.semana é varchar (não int); meses.mes / anos.ano
--                         (não "nome"); filtro de estilista só colaboradores tipo='estilista'
--   dashboard_producao  : terceirizados.nome_responsavel (não "nome")
--   dashboard_custos     : meses.mes (não "nome")
-- estoque e financeiro já funcionavam e não são tocadas aqui.

CREATE OR REPLACE FUNCTION public.dashboard_colecao(p_mes uuid DEFAULT NULL::uuid, p_ano uuid DEFAULT NULL::uuid, p_semana integer DEFAULT NULL::integer, p_colecao text DEFAULT NULL::text, p_estilista uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND (p_semana IS NULL OR mo.semana = p_semana::text)
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


CREATE OR REPLACE FUNCTION public.dashboard_producao()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    SELECT t.terceirizado_id, t.data_enviado, t.data_prevista, t.data_entregue,
           t.cad_id, COALESCE(t.quantidade_recebida,0) AS qrec, COALESCE(t.quantidade_defeito,0) AS qdef
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    WHERE t.terceirizado_id IS NOT NULL
    UNION ALL
    SELECT a.terceirizado_id, a.data_enviado, a.data_prevista, a.data_entregue,
           a.cad_id, 0::int AS qrec, 0::int AS qdef
    FROM producao_acabamento a
    JOIN cad c ON c.id = a.cad_id AND c.tenant_id = v_tenant
    WHERE a.terceirizado_id IS NOT NULL
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
$function$;


CREATE OR REPLACE FUNCTION public.dashboard_custos(p_colecao text DEFAULT NULL::text, p_mes uuid DEFAULT NULL::uuid, p_categoria uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'meses', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome', CASE WHEN mes LIKE '%|%' THEN split_part(mes,'|',2) ELSE mes END) ORDER BY mes) FROM meses WHERE tenant_id=v_tenant), '[]'::jsonb),
      'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM categorias_produto WHERE tenant_id=v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id=v_tenant AND colecao IS NOT NULL), '[]'::jsonb)
    )
  );
END;
$function$;
