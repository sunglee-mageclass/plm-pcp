-- Achados MEDIOS, release R12 (Dashboards; banco ANTES do site): os dashboards leem a FONTE UNICA.
--   preco M3  _dashboard_custos_core: previsto/real/confirmado passam a vir de _custo_unitario_modelos_core (a mesma
--             conta de custo_unitario_modelos, do Sheet e da Integracao) - revenda e importado deixam de aparecer pelo
--             custo_peca_previsto (Vestido Teste 0,20 -> 29,89; QA T25 importado 7,77 -> 104,04). Nao confirmado (ou
--             compra ainda nao recebida, real nulo na fonte) -> real = previsto, como antes (a tela mostra "-").
--             _custo_unitario_modelos_core fica INTOCADA (so e chamada).
--   prod #2   _dashboard_colecao_core: "Lancado" = modelos.lancado SOZINHO (inv. #6; antes exigia enviado_cad, que o
--             comprado nunca tem). Comprado com CAD (o receber materializa o CAD) conta como "Em Producao"; o lancado
--             sai de Planejamento/Desenvolvimento/Producao (ruling do controlador: NOT ec nas l.28-33). Interno: igual a
--             antes (enviado_cad), exceto o lancado sem enviado_cad (0 hoje), que passa a Lancados.
--   prod #6   _dashboard_producao_core: chave NOVA aprovadoNaoLancado (modelos na coluna "Aprovado" ainda NAO lancados;
--             ex.: a Blusa Master da Loja Teste, aprovada E lancada, sai). kanbanDev (grafico) NAO muda.
--   prod #7   _dashboard_leadtime_core e _dashboard_leadtime_itens_core (P-185 A, leitura literal - fix round 1): a
--             ULTIMA coluna do quadro ATUAL da loja (_kanban_status_rows, a mesma normalizacao do kanban) e o ponto de
--             chegada e NUNCA conta tempo - nem o trecho aberto (card parado, nao soma ate now()) nem o fechado (card que
--             saiu e voltou). As outras colunas e os status antigos que sairam do quadro: iguais a antes.
--             Fix round 2: o card cujo UNICO historico e a ultima coluna continua em dashboard_leadtime_itens (sem
--             etapas), para nao sumir da matriz nem do filtro colecao/subcolecao da aba Desenvolvimento.
-- Funcoes STABLE, so leitura; nada gravado muda.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06) - md5 "antes" da copia 54422 = producao.
--   public._dashboard_custos_core(date,date,text,uuid,uuid)
--     ANTES  4c30871b2f9491cfd568d6ff53cb13d8  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 177263673f730f333b2870acd59e8859  (este arquivo; reaplicar = no-op)
--   public._dashboard_colecao_core(date,date,text,uuid,uuid)
--     ANTES  07aa235a9e4fc154e90dcb61ddfbe47f  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 5dbe4d89fcaf1c1b77860cb3a8e132c8  (este arquivo; reaplicar = no-op)
--   public._dashboard_producao_core(date,date,text,uuid)
--     ANTES  5437c394c0b576f8875f6ce526f020af  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 17424a059ae47674e244701f5a0fbfe4  (este arquivo; reaplicar = no-op)
--   public._dashboard_leadtime_core()
--     ANTES  290807edf970fef70f1335446ac2fd45  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 520312bb84b32f35b63f056e93d51c54  (este arquivo; reaplicar = no-op)
--   public._dashboard_leadtime_itens_core(uuid,text,text)
--     ANTES  a049357d264bc60543d8bb804b49cdec  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS e90d44175464c66e6576f0f8a4bea1dd  (este arquivo; reaplicar = no-op)
--   Sem mudanca (so guarda):
--     public._custo_unitario_modelos_core(uuid[])             d26c7c9afb636f6ed26e66daf76e92ae  INTOCADA (fonte unica do custo; so chamada)  -- CONFIRMADO: Passo 0 (01/out 11:06)
--     public._kanban_status_rows(uuid)                        df58faac2e3d49f56c1d8fa4dd6d5e17  INTOCADA (ultima coluna do quadro)  -- PROVISORIO (copia): conferir no Passo 0 do kit R12
--     public.dashboard_custos(date,date,text,uuid,uuid)       354c9259b9f5466a7a8187ee830bceee  chamador sem mudanca  -- PROVISORIO (copia): conferir no Passo 0 do kit R12
--     public.dashboard_colecao(date,date,text,uuid,uuid)      4e351a33a919a60139518606b50729c3  chamador sem mudanca  -- PROVISORIO (copia): conferir no Passo 0 do kit R12
--     public.dashboard_producao(date,date,text,uuid)          8280bd12907d89522a215512a03821b4  chamador sem mudanca  -- PROVISORIO (copia): conferir no Passo 0 do kit R12
--     public.dashboard_leadtime()                             20f167f5d4825b2dada65b45e1c35f99  chamador sem mudanca  -- PROVISORIO (copia): conferir no Passo 0 do kit R12
--     public.dashboard_leadtime_itens(uuid,text,text)         a685c48508eee5449811b49e675e7432  chamador sem mudanca  -- PROVISORIO (copia): conferir no Passo 0 do kit R12
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto da propria funcao; nada em tabela, nada em auth/storage).
-- Sem DDL de tabela, sem DROP, sem funcao nova. ACL: CREATE OR REPLACE mantem a de hoje (os 5 _core so com
-- postgres/service_role - inv. #9); o REVOKE abaixo e idempotente (nao ha o que tirar hoje) e a pos-condicao confere.
-- Volta: supabase/rollback/20261022100000_dashboards_fonte_unica_down.sql (devolve os 5 textos de antes, com guarda
-- dos de depois). LIFO: nenhum inverso anterior confere estes md5 (grep em supabase/rollback: 0). ATENCAO: a migration
-- 20261019300000_custo_previsto_servidor.sql confere _dashboard_custos_core 4c30871b como 'dep' - reaplicar AQUELA
-- ida exige desfazer esta antes.
-- Site (depois do banco): dashboard.tsx le aprovadoNaoLancado (cai no calculo antigo pela coluna se a chave faltar).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r12_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r12_md5_aceitos VALUES
  ('public._dashboard_custos_core(date,date,text,uuid,uuid)', '4c30871b2f9491cfd568d6ff53cb13d8', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._dashboard_custos_core(date,date,text,uuid,uuid)', '177263673f730f333b2870acd59e8859', 'depois'),
  ('public._dashboard_colecao_core(date,date,text,uuid,uuid)', '07aa235a9e4fc154e90dcb61ddfbe47f', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._dashboard_colecao_core(date,date,text,uuid,uuid)', '5dbe4d89fcaf1c1b77860cb3a8e132c8', 'depois'),
  ('public._dashboard_producao_core(date,date,text,uuid)', '5437c394c0b576f8875f6ce526f020af', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._dashboard_producao_core(date,date,text,uuid)', '17424a059ae47674e244701f5a0fbfe4', 'depois'),
  ('public._dashboard_leadtime_core()', '290807edf970fef70f1335446ac2fd45', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._dashboard_leadtime_core()', '520312bb84b32f35b63f056e93d51c54', 'depois'),
  ('public._dashboard_leadtime_itens_core(uuid,text,text)', 'a049357d264bc60543d8bb804b49cdec', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._dashboard_leadtime_itens_core(uuid,text,text)', 'e90d44175464c66e6576f0f8a4bea1dd', 'depois'),
  ('public._custo_unitario_modelos_core(uuid[])', 'd26c7c9afb636f6ed26e66daf76e92ae', 'dep'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._kanban_status_rows(uuid)', 'df58faac2e3d49f56c1d8fa4dd6d5e17', 'dep'),  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R12
  ('public.dashboard_custos(date,date,text,uuid,uuid)', '354c9259b9f5466a7a8187ee830bceee', 'dep'),  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R12
  ('public.dashboard_colecao(date,date,text,uuid,uuid)', '4e351a33a919a60139518606b50729c3', 'dep'),  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R12
  ('public.dashboard_producao(date,date,text,uuid)', '8280bd12907d89522a215512a03821b4', 'dep'),  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R12
  ('public.dashboard_leadtime()', '20f167f5d4825b2dada65b45e1c35f99', 'dep'),  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R12
  ('public.dashboard_leadtime_itens(uuid,text,text)', 'a685c48508eee5449811b49e675e7432', 'dep');  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R12

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r12_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r12: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r12_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r12: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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

  -- [medios R12, preco M3] previsto/real/confirmado vem da FONTE UNICA _custo_unitario_modelos_core (a mesma de
  -- custo_unitario_modelos: revenda e importado pelo custo da compra/landed; interno pelo CAD confirmado). Nao
  -- confirmado (ou real ainda nulo na compra nao recebida) -> real = previsto, como antes.
  WITH ids AS (
    SELECT m.id
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  ),
  cu AS (
    SELECT COALESCE(public._custo_unitario_modelos_core(COALESCE((SELECT array_agg(ids.id) FROM ids), '{}'::uuid[])), '{}'::jsonb) AS j
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, m.colecao, m.versao,
      COALESCE(((cu.j -> (m.id::text)) ->> 'confirmado')::boolean, false) AS confirmado,
      COALESCE(((cu.j -> (m.id::text)) ->> 'previsto')::numeric, 0) AS previsto,
      COALESCE(((cu.j -> (m.id::text)) ->> 'real')::numeric, ((cu.j -> (m.id::text)) ->> 'previsto')::numeric, 0) AS real
    FROM modelos m
    JOIN ids ON ids.id = m.id
    CROSS JOIN cu
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
$function$;

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

CREATE OR REPLACE FUNCTION public._dashboard_leadtime_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cfg jsonb;
  v_has_cfg boolean;
  v_out jsonb;
  v_ultima text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  -- [medios R12, prod #7, P-185 A] a ULTIMA coluna do quadro e o ponto de chegada: NAO conta tempo.
  SELECT r.key INTO v_ultima FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord DESC LIMIT 1;
  SELECT leadtime INTO v_cfg FROM public.tenant_config WHERE tenant_id = v_tenant;
  v_has_cfg := (v_cfg ? 'etapas') AND jsonb_array_length(COALESCE(v_cfg->'etapas', '[]'::jsonb)) > 0;

  WITH
  -- Durações MACRO por modelo (em dias). sub=0 (só serviços-micro usa sub p/ ordenar).
  macro AS (
    SELECT 'planejamento'::text AS etapa, 'macro'::text AS tipo, 'Planejamento'::text AS label,
           (m.ordem_criacao_enviada_at::date - m.created_at::date)::numeric AS dias, 0::numeric AS sub
      FROM public.modelos m
      WHERE m.tenant_id = v_tenant AND m.ordem_criacao_enviada_at IS NOT NULL
    UNION ALL
    SELECT 'cad_corte', 'macro', 'Explosão',
           (c.data_enviado_corte - c.created_at::date)::numeric, 0
      FROM public.cad c
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL
    UNION ALL
    SELECT 'servicos', 'macro', 'Tempo em produção',
           (svc.dt - c.data_enviado_corte)::numeric, 0
      FROM public.cad c
      JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL AND svc.dt IS NOT NULL
    UNION ALL
    SELECT 'cq', 'macro', 'CQ',
           (q.confirmado_at::date - COALESCE(svc.dt, q.created_at::date))::numeric, 0
      FROM public.controle_qualidade q
      JOIN public.cad c ON c.id = q.cad_id AND c.tenant_id = v_tenant
      LEFT JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT 'direcionamento', 'macro', 'Direcionamento',
           (c.direcionamento_confirmado_at::date - q.confirmado_at::date)::numeric, 0
      FROM public.cad c
      JOIN public.controle_qualidade q ON q.cad_id = c.id
      WHERE c.tenant_id = v_tenant AND c.direcionamento_confirmado_at IS NOT NULL AND q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT 'lancamento', 'macro', 'Lançamento',
           (m.data_lancamento - c.direcionamento_confirmado_at::date)::numeric, 0
      FROM public.modelos m
      JOIN public.cad c ON c.modelo_id = m.id
      WHERE m.tenant_id = v_tenant AND m.data_lancamento IS NOT NULL AND c.direcionamento_confirmado_at IS NOT NULL
  ),
  -- Serviços MICRO: cada categoria de serviço (data_enviado → data_entregue). sub=ordem.
  svc AS (
    SELECT ('servico_cat:' || ct.id::text) AS etapa, 'servico'::text AS tipo, ct.nome::text AS label,
           (pt.data_entregue - pt.data_enviado)::numeric AS dias, COALESCE(ct.ordem, 0)::numeric AS sub
      FROM public.producao_terceirizados pt
      JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
      WHERE ct.tenant_id = v_tenant AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL
  ),
  -- Tempo em cada COLUNA do kanban (Desenvolvimento) via o histórico.
  -- [medios R12, P-185 A] a ultima coluna do quadro NUNCA conta tempo (trecho aberto ou fechado). O lead() e calculado
  -- ANTES do filtro: a coluna anterior fecha quando o card ENTRA na ultima. Status fora do quadro atual seguem contando.
  kb AS (
    SELECT ('kanban:' || h.status) AS etapa, 'kanban'::text AS tipo, h.status AS label,
           (EXTRACT(EPOCH FROM (COALESCE(h.nxt, now()) - h.entrou_at)) / 86400.0)::numeric AS dias, 0::numeric AS sub
      FROM (SELECT h0.status, h0.entrou_at,
                   lead(h0.entrou_at) OVER (PARTITION BY h0.modelo_id ORDER BY h0.entrou_at) AS nxt
              FROM public.modelo_kanban_historico h0
             WHERE h0.tenant_id = v_tenant) h
      WHERE h.status IS DISTINCT FROM v_ultima
  ),
  spans AS (SELECT * FROM macro UNION ALL SELECT * FROM svc UNION ALL SELECT * FROM kb),
  -- Etapas escolhidas na Config da Loja (ideal + ordem de exibição).
  sel AS (
    SELECT e->>'key' AS key, (e->>'idealDias')::numeric AS ideal, ord
      FROM jsonb_array_elements(COALESCE(v_cfg->'etapas', '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
  ),
  stats AS (
    SELECT s.etapa, s.tipo, s.label, MAX(s.sub) AS sub,
      COALESCE(MIN(sel.ideal), CASE WHEN s.tipo = 'kanban' THEN 5 ELSE 7 END) AS ideal,
      MIN(sel.ord) AS ord,
      COUNT(*) AS n,
      ROUND(AVG(GREATEST(s.dias, 0)), 1) AS media
    FROM spans s
    LEFT JOIN sel ON sel.key = s.etapa
    -- bootstrap (sem config) NÃO mostra serviços-micro; com config, só as escolhidas.
    WHERE (NOT v_has_cfg AND s.tipo <> 'servico') OR sel.key IS NOT NULL
    GROUP BY s.etapa, s.tipo, s.label
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'etapa', etapa, 'tipo', tipo, 'label', label, 'sub', sub,
      'idealDias', ideal, 'nModelos', n, 'duracaoMedia', media,
      'foraSla', fora, 'pctNoPrazo', pct
    ) ORDER BY ord NULLS LAST, tipo DESC, sub, media DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT st.*,
      (SELECT COUNT(*) FROM spans s2 WHERE s2.etapa = st.etapa AND GREATEST(s2.dias,0) > st.ideal) AS fora,
      (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE GREATEST(s2.dias,0) <= st.ideal) / NULLIF(COUNT(*),0), 0)
         FROM spans s2 WHERE s2.etapa = st.etapa) AS pct
    FROM stats st
  ) z;

  RETURN jsonb_build_object(
    'etapas', v_out,
    'kanbanOrder', (SELECT status_kanban FROM public.tenant_config WHERE tenant_id = v_tenant)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._dashboard_leadtime_itens_core(p_colecao uuid DEFAULT NULL::uuid, p_subcolecao text DEFAULT NULL::text, p_semana text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
  v_sla_servico text;  -- etapa cujo prazo vem do SLA da Sub1 (servicos | servico_cat:<id>)
  v_ultima text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  -- [medios R12, prod #7, P-185 A] a ULTIMA coluna do quadro e o ponto de chegada: NAO conta tempo.
  SELECT r.key INTO v_ultima FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord DESC LIMIT 1;
  SELECT leadtime->>'slaServico' INTO v_sla_servico FROM public.tenant_config WHERE tenant_id = v_tenant;

  WITH
  spans AS (
    SELECT m.id AS modelo_id, 'planejamento'::text AS etapa,
           (m.ordem_criacao_enviada_at::date - m.created_at::date)::numeric AS dias
      FROM public.modelos m
      WHERE m.tenant_id = v_tenant AND m.ordem_criacao_enviada_at IS NOT NULL
    UNION ALL
    -- COMPRA (revenda): OC feita → recebimento. Liga ocs_p_acabado → produtos_acabados → modelo.
    SELECT pa.modelo_id, 'compra', (oc.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_p_acabado oc
      JOIN public.produtos_acabados pa ON pa.id = oc.produto_acabado_id AND pa.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND oc.data_entrega IS NOT NULL AND pa.modelo_id IS NOT NULL
    UNION ALL
    -- COMPRA (importado): OC feita → recebimento (inclui trânsito/câmbio; etapas de câmbio são
    -- financeiras, sem marco de tempo próprio). Liga ocs_importado → produtos_importados → modelo.
    SELECT pi.modelo_id, 'compra', (oc.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_importado oc
      JOIN public.produtos_importados pi ON pi.id = oc.produto_importado_id AND pi.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND oc.data_entrega IS NOT NULL AND pi.modelo_id IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cad_corte', (c.data_enviado_corte - c.created_at::date)::numeric
      FROM public.cad c
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'servicos', (svc.dt - c.data_enviado_corte)::numeric
      FROM public.cad c
      JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL AND svc.dt IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cq', (q.confirmado_at::date - COALESCE(svc.dt, q.created_at::date))::numeric
      FROM public.controle_qualidade q
      JOIN public.cad c ON c.id = q.cad_id AND c.tenant_id = v_tenant
      LEFT JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'direcionamento', (c.direcionamento_confirmado_at::date - q.confirmado_at::date)::numeric
      FROM public.cad c
      JOIN public.controle_qualidade q ON q.cad_id = c.id
      WHERE c.tenant_id = v_tenant AND c.direcionamento_confirmado_at IS NOT NULL AND q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT m.id, 'lancamento', (m.data_lancamento - c.direcionamento_confirmado_at::date)::numeric
      FROM public.modelos m
      JOIN public.cad c ON c.modelo_id = m.id
      WHERE m.tenant_id = v_tenant AND m.data_lancamento IS NOT NULL AND c.direcionamento_confirmado_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'servico_cat:' || ct.id::text, (pt.data_entregue - pt.data_enviado)::numeric
      FROM public.producao_terceirizados pt
      JOIN public.cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
      JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
      WHERE pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL
    UNION ALL
    -- [medios R12, P-185 A] a ultima coluna do quadro NUNCA conta tempo (trecho aberto ou fechado). O lead() e calculado
  -- ANTES do filtro: a coluna anterior fecha quando o card ENTRA na ultima. Status fora do quadro atual seguem contando.
    SELECT h.modelo_id, 'kanban:' || h.status,
           (EXTRACT(EPOCH FROM (COALESCE(h.nxt, now()) - h.entrou_at)) / 86400.0)::numeric
      FROM (SELECT h0.modelo_id, h0.status, h0.entrou_at,
                   lead(h0.entrou_at) OVER (PARTITION BY h0.modelo_id ORDER BY h0.entrou_at) AS nxt
              FROM public.modelo_kanban_historico h0
             WHERE h0.tenant_id = v_tenant) h
      WHERE h.status IS DISTINCT FROM v_ultima
  ),
  per_etapa AS (
    SELECT modelo_id, etapa, ROUND(SUM(GREATEST(dias, 0)), 1) AS dias
      FROM spans GROUP BY modelo_id, etapa
  ),
  dur AS (
    SELECT modelo_id, jsonb_object_agg(etapa, dias) AS duracoes
      FROM per_etapa GROUP BY modelo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'modelo_id', m.id, 'ref', m.ref, 'nome', m.nome, 'versao', m.versao,
      'origem', COALESCE(m.origem, 'interno'),
      'colecao', COALESCE(col.nome, m.colecao), 'colecao_id', m.colecao_id,
      'subcolecao', m.subcolecao, 'semana', m.semana,
      'sub1_id', m.subcategoria1_id, 'sub1', s1.nome, 'sub1_sla', s1.sla_oficina,
      'duracoes', COALESCE(d.duracoes, '{}'::jsonb)
    ) ORDER BY COALESCE(col.nome, m.colecao) NULLS LAST, m.subcolecao NULLS LAST, m.semana NULLS LAST, m.ref NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM public.modelos m
  LEFT JOIN dur d ON d.modelo_id = m.id
  LEFT JOIN public.colecoes col ON col.id = m.colecao_id
  LEFT JOIN public.subcategorias1_produto s1 ON s1.id = m.subcategoria1_id
  WHERE m.tenant_id = v_tenant
    -- [medios R12, fix round 2] o card cujo UNICO historico e a ultima coluna (que nao conta tempo) continua na lista,
    -- com duracoes vazias: mesmo conjunto de cards de antes (todo card com historico tinha trecho de kanban).
    AND (d.modelo_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.modelo_kanban_historico hk WHERE hk.modelo_id = m.id AND hk.tenant_id = v_tenant))
    AND (p_colecao IS NULL OR m.colecao_id = p_colecao)
    AND (p_subcolecao IS NULL OR m.subcolecao = p_subcolecao)
    AND (p_semana IS NULL OR m.semana = p_semana);

  RETURN jsonb_build_object('itens', v_out, 'slaServico', v_sla_servico);
END;
$function$;

-- inv. #9: os _core seguem sem EXECUTE para PUBLIC/anon/authenticated (idempotente; a ACL de hoje ja e essa).
REVOKE EXECUTE ON FUNCTION public._dashboard_custos_core(date,date,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_colecao_core(date,date,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_producao_core(date,date,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_leadtime_core() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._dashboard_leadtime_itens_core(uuid,text,text) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r12_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r12: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r12: % ficou executavel por anon', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF r.assinatura LIKE 'public.\_%' AND has_function_privilege('authenticated', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r12: % ficou executavel por authenticated (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.assinatura) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r12: % ficou executavel por PUBLIC (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF r.assinatura LIKE 'public.\_dashboard\_%' AND (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) <> 's' THEN
      RAISE EXCEPTION 'medios_r12: % deixou de ser STABLE', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- os wrappers seguem executaveis por authenticated (a tela chama por eles)
  IF NOT has_function_privilege('authenticated', 'public.dashboard_custos(date,date,text,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.dashboard_colecao(date,date,text,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.dashboard_producao(date,date,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.dashboard_leadtime()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.dashboard_leadtime_itens(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r12: um wrapper dashboard_* perdeu o EXECUTE de authenticated' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
