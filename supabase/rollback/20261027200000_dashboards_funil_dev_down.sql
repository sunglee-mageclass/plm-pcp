-- INVERSO de supabase/migrations/20261027200000_dashboards_funil_dev.sql (achados LEVES L4, prod #10). Devolve o
-- texto da R12 (20261022100000) de _dashboard_colecao_core (Desenvolvimento = status_planejamento 'planejado') e de
-- _dashboard_producao_core (kanbanDev pelos 'planejado').
-- Guarda: so roda se as 2 estao EXATAMENTE com o texto da ida (md5 de depois) e os chamadores seguem com o texto
-- conferido; outro -> P0001 e nada muda. Nada gravado muda (so leitura).
-- Ordem: o site da L4 nao depende deste banco (mesmo contrato de chaves). LIFO da aplicacao: este inverso roda DEPOIS
-- do inverso da OTB da L4 (20261027210000_otb_realizado_sem_reprovado_down.sql) e ANTES do inverso da R12
-- (20261022100000_dashboards_fonte_unica_down.sql), que confere 5dbe4d89/17424a05 - exatamente o texto que este
-- arquivo devolve.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._dashboard_colecao_core(date,date,text,uuid,uuid)', '656f77cd21612d1ab4c6498fac6e3b6e'),
      ('public._dashboard_producao_core(date,date,text,uuid)', '2997a4b27f4426cdd125b76c794c7a87'),
      ('public.dashboard_colecao(date,date,text,uuid,uuid)', '4e351a33a919a60139518606b50729c3'),
      ('public.dashboard_producao(date,date,text,uuid)', '8280bd12907d89522a215512a03821b4')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l4 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l4 (volta): % nao esta com o texto esperado da 20261027200000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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
  v_por_linha jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- [medios R12, prod #2] "Lancado" = modelos.lancado SOZINHO (inv. #6, fonte unica). O comprado (revenda/importado)
  -- nunca vai a Explosao por enviado_cad: conta como "Em Producao" quando ja tem CAD (o receber materializa o CAD) e,
  -- lancado, sai de Planejamento/Desenvolvimento/Producao e entra em Lancados (ruling do controlador, plan.md).
  WITH mods AS (
    SELECT mo.id, mo.status_planejamento AS sp,
           (COALESCE(mo.enviado_cad, false)
             OR (mo.origem IN ('revenda','importado') AND EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = mo.id))) AS ec,
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
    count(*) FILTER (WHERE NOT ec AND NOT lanc AND sp IS DISTINCT FROM 'planejado'),
    count(*) FILTER (WHERE NOT ec AND NOT lanc AND sp = 'planejado'),
    count(*) FILTER (WHERE ec AND NOT lanc),
    count(*) FILTER (WHERE lanc),
    count(*) FILTER (WHERE ec OR lanc OR sp = 'planejado'),
    count(*) FILTER (WHERE ec OR lanc),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', nome, 'value', total))
              FROM (SELECT COALESCE(cp.nome,'Sem categoria') AS nome, count(*) AS total
                    FROM mods LEFT JOIN categorias_produto cp ON cp.id = mods.cat GROUP BY 1) x), '[]'::jsonb)
  INTO v_total, v_planej, v_desenv, v_prod, v_lanc, v_reach_dev, v_reach_prod, v_pie
  FROM mods;

  -- Destrinche por LINHA — MESMAS 5 métricas dos KPIs, por linha_id (NULL => "Sem linha").
  WITH mods AS (
    SELECT mo.linha_id AS linha_id, mo.status_planejamento AS sp,
           (COALESCE(mo.enviado_cad, false)
             OR (mo.origem IN ('revenda','importado') AND EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = mo.id))) AS ec,
           COALESCE(mo.lancado, false) AS lanc
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_colecao IS NULL OR mo.colecao = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
      AND (p_linha IS NULL OR mo.linha_id = p_linha)
      AND public._modelo_no_periodo(mo.mes_id, mo.ano_id, p_inicio, p_fim)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'linha_id', linha_id, 'nome', nome,
           'total', total, 'planejamento', planejamento, 'desenvolvimento', desenvolvimento,
           'producao', producao, 'lancados', lancados
         ) ORDER BY (linha_id IS NULL), nome), '[]'::jsonb)
  INTO v_por_linha
  FROM (
    SELECT mods.linha_id AS linha_id, COALESCE(l.nome,'Sem linha') AS nome,
      count(*) AS total,
      count(*) FILTER (WHERE NOT mods.ec AND NOT mods.lanc AND mods.sp IS DISTINCT FROM 'planejado') AS planejamento,
      count(*) FILTER (WHERE NOT mods.ec AND NOT mods.lanc AND mods.sp = 'planejado') AS desenvolvimento,
      count(*) FILTER (WHERE mods.ec AND NOT mods.lanc) AS producao,
      count(*) FILTER (WHERE mods.lanc) AS lancados
    FROM mods LEFT JOIN linhas l ON l.id = mods.linha_id
    GROUP BY mods.linha_id, COALESCE(l.nome,'Sem linha')
  ) x;

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object('total', v_total, 'planejamento', v_planej, 'desenvolvimento', v_desenv, 'producao', v_prod, 'lancados', v_lanc),
    'funnel', jsonb_build_array(
      jsonb_build_object('name','Total','value', v_total),
      jsonb_build_object('name','Desenvolvimento','value', v_reach_dev),
      jsonb_build_object('name','Produção','value', v_reach_prod),
      jsonb_build_object('name','Lançados','value', v_lanc)
    ),
    'pie', v_pie,
    'porLinha', v_por_linha,
    'filtros', jsonb_build_object(
      'estilistas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM colaboradores WHERE tenant_id = v_tenant AND tipo = 'estilista'), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL AND colecao <> ''), '[]'::jsonb)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._dashboard_producao_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_timeline jsonb; v_kanban jsonb; v_sla jsonb; v_cortes jsonb; v_finalizadas jsonb; v_defeito_mes jsonb; v_por_colecao jsonb; v_por_linha jsonb;
  v_no_prazo int := 0; v_atrasos int := 0; v_total int := 0;
  v_usa_corte boolean := false;
  v_aprov_nao_lanc int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- A loja usa o SERVIÇO "Corte" (terceirizado)? Se não (só PL, corte incluso), os
  -- cards "Modelos cortados / Grade cortada" são redundantes e ficam escondidos.
  SELECT EXISTS(
    SELECT 1 FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
     WHERE ct.nome ILIKE 'corte' AND COALESCE(t.ativo, true)
  ) INTO v_usa_corte;

  -- Timeline (etapa de produção atual) com versão
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'ref', ref, 'nome', nome, 'versao', versao, 'etapa', etapa) ORDER BY ref), '[]'::jsonb)
  INTO v_timeline
  FROM (
    SELECT cd.id, m.ref, m.nome, m.versao,
      CASE
        WHEN m.lancado THEN 'Lançado'
        WHEN EXISTS(SELECT 1 FROM direcionamento d WHERE d.cad_id = cd.id)
          OR EXISTS(SELECT 1 FROM direcionamento_lojas dl WHERE dl.cad_id = cd.id) THEN 'Direcionamento'
        WHEN EXISTS(SELECT 1 FROM controle_qualidade q WHERE q.cad_id = cd.id) THEN 'Controle de Qualidade'
        WHEN EXISTS(SELECT 1 FROM producao_oficina o WHERE o.cad_id = cd.id AND o.data_enviado IS NOT NULL) THEN 'Oficina'
        WHEN EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = cd.id AND t.ativo) THEN 'Serviço'
        ELSE 'CAD'
      END AS etapa
    FROM cad cd JOIN modelos m ON m.id = cd.modelo_id
    WHERE cd.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
    ORDER BY m.ref LIMIT 200
  ) t;

  -- Kanban do DESENVOLVIMENTO (config de tenant_config.status_kanban; fallback DEFAULT)
  WITH defmap(dkey, dlabel) AS (VALUES
    ('em_modelagem','Em Modelagem'), ('corte_piloto_1','Corte de Piloto I'),
    ('corte_piloto_2','Corte de Piloto II'), ('corte_piloto_3','Corte de Piloto III'),
    ('em_pilotagem','Em Pilotagem'), ('prova_roupa_1','Prova de Roupa I'),
    ('prova_roupa_2','Prova de Roupa II'), ('prova_roupa_3','Prova de Roupa III'),
    ('prova_roupa_4','Prova de Roupa IV'), ('prova_roupa_5','Prova de Roupa V'),
    ('em_ajuste','Em Ajuste'), ('stand_by','Stand By'),
    ('reprovado','Reprovado'), ('aprovado','Aprovado')
  ),
  sk AS (
    SELECT COALESCE(
      (SELECT tc.status_kanban FROM tenant_config tc
         WHERE tc.tenant_id = v_tenant AND jsonb_typeof(tc.status_kanban) = 'array' AND jsonb_array_length(tc.status_kanban) > 0),
      (SELECT jsonb_agg(jsonb_build_object('key',dkey,'label',dlabel)) FROM defmap)
    ) AS arr
  ),
  cols AS (
    -- FIX: coluna-STRING → key via _kanban_resolve_key (slug/label→slug), NÃO a string crua. Assim
    -- "PCP"→"pcp" casa com modelos.status_desenvolvimento. Coluna-objeto usa key/id/value/slug e,
    -- na falta, resolve a partir do label (mesmo critério do _kanban_status_rows).
    SELECT t.ord,
      CASE jsonb_typeof(t.e) WHEN 'string' THEN public._kanban_resolve_key(t.e #>> '{}')
        ELSE COALESCE(t.e->>'key', t.e->>'id', t.e->>'value', t.e->>'slug',
                      public._kanban_resolve_key(COALESCE(t.e->>'label', t.e->>'nome', t.e->>'name', 's'||t.ord::text))) END AS key,
      CASE jsonb_typeof(t.e) WHEN 'string' THEN (t.e #>> '{}')
        ELSE COALESCE(t.e->>'label', t.e->>'nome', t.e->>'name', t.e->>'key', 's'||t.ord::text) END AS label
    FROM sk, LATERAL jsonb_array_elements(sk.arr) WITH ORDINALITY AS t(e, ord)
  ),
  cols2 AS (
    SELECT c.ord, c.key, c.label, (SELECT d.dkey FROM defmap d WHERE d.dlabel = c.label LIMIT 1) AS alias_key FROM cols c
  ),
  firstcol AS (SELECT key FROM cols2 ORDER BY ord LIMIT 1),
  mods AS (
    SELECT m.id,
      COALESCE((SELECT c.key FROM cols2 c WHERE c.key = m.status_desenvolvimento OR c.alias_key = m.status_desenvolvimento ORDER BY c.ord LIMIT 1),
               (SELECT key FROM firstcol)) AS bucket,
      COALESCE((SELECT SUM(COALESCE(mg.grade_total,0)) FROM modelo_grades mg WHERE mg.modelo_id = m.id), 0) AS grade,
      COALESCE(m.lancado, false) AS lanc
    FROM modelos m
    WHERE m.tenant_id = v_tenant AND m.status_planejamento = 'planejado'
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  ),
  agg AS (SELECT bucket, count(*) AS modelos, SUM(grade) AS grade FROM mods GROUP BY bucket),
  -- [medios R12, prod #6] coluna "Aprovado" = a de key exata 'aprovado'; senao a 1a cujo label contem "aprovad"
  -- (mesmo criterio do front). aprovadoNaoLancado = modelos nessa coluna que AINDA nao foram lancados.
  ap AS (SELECT c.key FROM cols2 c WHERE c.key = 'aprovado' OR c.label ~* 'aprovad'
          ORDER BY (c.key = 'aprovado') DESC, c.ord LIMIT 1)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'modelos', COALESCE(a.modelos,0), 'grade', COALESCE(a.grade,0)) ORDER BY c.ord), '[]'::jsonb),
         (SELECT count(*) FROM mods WHERE mods.bucket = (SELECT ap.key FROM ap) AND NOT mods.lanc)
  INTO v_kanban, v_aprov_nao_lanc
  FROM cols2 c LEFT JOIN agg a ON a.bucket = c.key;

  -- Cortes por mês = data de entrega dos Serviços (producao_terceirizados.data_entregue)
  WITH cortes AS (
    SELECT c.modelo_id,
      (SELECT max(t.data_entregue) FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.data_entregue IS NOT NULL) AS dt,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = c.id), 0) AS grade
    FROM cad c JOIN modelos m ON m.id = c.modelo_id
    WHERE c.tenant_id = v_tenant AND c.enviado_corte
      AND EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.data_entregue IS NOT NULL)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_cortes
  FROM (
    SELECT to_char(dt,'YYYY-MM') AS k, to_char(dt,'Mon/YY') AS mes,
           count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade
    FROM cortes
    WHERE dt IS NOT NULL AND (p_inicio IS NULL OR dt >= p_inicio) AND (p_fim IS NULL OR dt <= p_fim)
    GROUP BY 1, 2
  ) x;

  -- Produção finalizada por mês = Serviços com status finalizado
  WITH fin AS (
    SELECT c.modelo_id,
      (SELECT max(t.data_entregue) FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.status = 'finalizado' AND t.data_entregue IS NOT NULL) AS dt,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = c.id), 0) AS grade
    FROM cad c JOIN modelos m ON m.id = c.modelo_id
    WHERE c.tenant_id = v_tenant
      AND EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = c.id AND t.status = 'finalizado')
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'grade', grade) ORDER BY k), '[]'::jsonb)
  INTO v_finalizadas
  FROM (
    SELECT to_char(dt,'YYYY-MM') AS k, to_char(dt,'Mon/YY') AS mes,
           count(DISTINCT modelo_id) AS modelos, SUM(grade) AS grade
    FROM fin
    WHERE dt IS NOT NULL AND (p_inicio IS NULL OR dt >= p_inicio) AND (p_fim IS NULL OR dt <= p_fim)
    GROUP BY 1, 2
  ) y;

  -- SLA por terceirizado
  WITH entregas AS (
    -- Fornecedor = empresa, senão representante, senão colaborador — senão o serviço
    -- (via rep/colaborador ou sem fornecedor) some do "SLA por serviço".
    SELECT COALESCE(emp.nome_fantasia, rep.nome, col.nome, '—') AS nome,
           COALESCE(ct.nome, 'Serviço') AS tipo, t.data_enviado, t.data_prevista, t.data_entregue,
           COALESCE(t.quantidade_recebida,0) AS qrec, COALESCE(t.quantidade_defeito,0) AS qdef
    FROM producao_terceirizados t JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant JOIN modelos m ON m.id = c.modelo_id
      LEFT JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
      LEFT JOIN empresas emp ON emp.id = t.empresa_id
      LEFT JOIN representantes rep ON rep.id = t.representante_id
      LEFT JOIN colaboradores col ON col.id = t.colaborador_id
    WHERE (p_colecao IS NULL OR m.colecao = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'nome', nome, 'tipo', tipo, 'slaMedio', slaMedio, 'atrasos', atrasos, 'total', total,
      'pecasProduzidas', pecasProduzidas, 'pecasDefeito', pecasDefeito,
      'taxaDefeito', CASE WHEN pecasProduzidas > 0 THEN ROUND((pecasDefeito::numeric / pecasProduzidas) * 100, 2) ELSE 0 END
    )), '[]'::jsonb)
  INTO v_sla
  FROM (
    SELECT e.nome AS nome, e.tipo AS tipo,
      AVG(EXTRACT(EPOCH FROM (e.data_entregue::timestamp - e.data_enviado::timestamp))/86400)
        FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS slaMedio,
      COUNT(*) FILTER (WHERE e.data_entregue IS NOT NULL AND e.data_prevista IS NOT NULL AND e.data_entregue > e.data_prevista) AS atrasos,
      COUNT(*) FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS total,
      SUM(e.qrec) AS pecasProduzidas, SUM(e.qdef) AS pecasDefeito
    FROM entregas e
    GROUP BY e.nome, e.tipo
  ) s;

  -- KPI prazo
  WITH entregas2 AS (
    SELECT t.data_prevista, t.data_entregue
    FROM producao_terceirizados t JOIN cad c ON c.id=t.cad_id AND c.tenant_id=v_tenant JOIN modelos m ON m.id=c.modelo_id
    WHERE t.data_entregue IS NOT NULL AND t.data_prevista IS NOT NULL
      AND (p_colecao IS NULL OR m.colecao = p_colecao) AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT count(*) FILTER (WHERE data_entregue <= data_prevista), count(*) FILTER (WHERE data_entregue > data_prevista), count(*)
  INTO v_no_prazo, v_atrasos, v_total FROM entregas2;

    -- Taxa de defeito por mês (entregas de Serviços): Σ defeito / Σ recebido * 100.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'taxa', taxa) ORDER BY k), '[]'::jsonb)
  INTO v_defeito_mes
  FROM (
    SELECT to_char(t.data_entregue,'YYYY-MM') AS k, to_char(t.data_entregue,'Mon/YY') AS mes,
           CASE WHEN SUM(COALESCE(t.quantidade_recebida,0)) > 0
                THEN ROUND(SUM(COALESCE(t.quantidade_defeito,0))::numeric / SUM(COALESCE(t.quantidade_recebida,0)) * 100, 2)
                ELSE 0 END AS taxa
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE t.data_entregue IS NOT NULL
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha   IS NULL OR m.linha_id = p_linha)
    GROUP BY 1, 2
  ) d;

  WITH g AS (
    SELECT m.colecao AS nome, count(*) AS modelos,
           SUM(COALESCE((SELECT SUM(COALESCE(mg.grade_total,0)) FROM modelo_grades mg WHERE mg.modelo_id = m.id),0)) AS grade
    FROM modelos m
    WHERE m.tenant_id = v_tenant AND COALESCE(m.colecao,'') <> ''
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY m.colecao
  ), d AS (
    SELECT m.colecao AS nome,
           CASE WHEN SUM(COALESCE(t.quantidade_recebida,0)) > 0
                THEN ROUND(SUM(COALESCE(t.quantidade_defeito,0))::numeric / SUM(COALESCE(t.quantidade_recebida,0)) * 100, 2)
                ELSE 0 END AS defeito
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    WHERE t.data_entregue IS NOT NULL AND COALESCE(m.colecao,'') <> ''
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY m.colecao
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', g.nome, 'modelos', g.modelos, 'grade', g.grade, 'defeito', COALESCE(d.defeito,0)) ORDER BY g.grade DESC), '[]'::jsonb)
  INTO v_por_colecao
  FROM g LEFT JOIN d ON d.nome = g.nome;

  WITH g AS (
    SELECT l.nome AS nome, count(*) AS modelos,
           SUM(COALESCE((SELECT SUM(COALESCE(mg.grade_total,0)) FROM modelo_grades mg WHERE mg.modelo_id = m.id),0)) AS grade
    FROM modelos m JOIN linhas l ON l.id = m.linha_id
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY l.nome
  ), d AS (
    SELECT l.nome AS nome,
           CASE WHEN SUM(COALESCE(t.quantidade_recebida,0)) > 0
                THEN ROUND(SUM(COALESCE(t.quantidade_defeito,0))::numeric / SUM(COALESCE(t.quantidade_recebida,0)) * 100, 2)
                ELSE 0 END AS defeito
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    JOIN linhas l ON l.id = m.linha_id
    WHERE t.data_entregue IS NOT NULL
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
    GROUP BY l.nome
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', g.nome, 'modelos', g.modelos, 'grade', g.grade, 'defeito', COALESCE(d.defeito,0)) ORDER BY g.grade DESC), '[]'::jsonb)
  INTO v_por_linha
  FROM g LEFT JOIN d ON d.nome = g.nome;

RETURN jsonb_build_object(
    'defeitoPorMes', v_defeito_mes,
    'porColecao', v_por_colecao, 'porLinha', v_por_linha,
    'timeline', v_timeline, 'kanbanDev', v_kanban, 'aprovadoNaoLancado', v_aprov_nao_lanc, 'cortesPorMes', v_cortes, 'usaCorte', v_usa_corte, 'finalizadasPorMes', v_finalizadas, 'slaPorTerc', v_sla,
    'kpiPrazo', jsonb_build_object('noPrazo', v_no_prazo, 'atrasadas', v_atrasos,
      'pct', CASE WHEN v_total > 0 THEN ROUND((v_no_prazo::numeric/v_total)*100) ELSE 0 END),
    'filtros', jsonb_build_object(
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._dashboard_colecao_core(date,date,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_producao_core(date,date,text,uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._dashboard_colecao_core(date,date,text,uuid,uuid)', '5dbe4d89fcaf1c1b77860cb3a8e132c8'),
      ('public._dashboard_producao_core(date,date,text,uuid)', '17424a059ae47674e244701f5a0fbfe4')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l4 (volta): pos-condicao falhou - % nao voltou ao texto da R12', r.s USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.s, 'EXECUTE') OR has_function_privilege('authenticated', r.s, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l4 (volta): % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(r.s)) <> 's'
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.s)) THEN
      RAISE EXCEPTION 'leves_l4 (volta): % deixou de ser STABLE SECURITY DEFINER', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
