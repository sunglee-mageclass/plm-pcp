-- Kanban PL configuravel - Onda 2, Task 1: config + chave + derivacao em LOTE do board PL.
-- ADITIVA e idempotente (CREATE OR REPLACE). SO BANCO; nenhuma tela usa ainda (etapas_pl_automatico
-- default false - a frente so liga na Onda 3). Espelha a camada do Dev (20260930130000) para o board PL,
-- trocando status_desenvolvimento->status_etapa_pl, status_kanban->etapas_pl_kanban,
-- kanban_requisitos->etapas_pl_requisitos, _avaliar_condicoes_kanban_core->_avaliar_condicoes_etapas_pl_core.
--
-- O PL NAO tem revenda nem excecoes: board UNICO (etapas_pl_kanban), requisitos por etapa
-- (etapas_pl_requisitos), excecoes sempre {}. Elegivel no PL = status_etapa_pl IS NOT NULL (esta no PL),
-- NAO "ordem_criacao_enviada AND NOT lancado" (criterio do Dev).
--
-- REUSA as PURAS do Dev (IMMUTABLE, parametrizadas): _kanban_fluxo, _kanban_derivar_puro,
-- _kanban_norm, _kanban_lista, _kanban_coluna_manual, _kanban_req_efetivos (20260930130000). Passamos o
-- board PL sob a chave 'status_kanban' num cfg-shim para _kanban_fluxo (que le status_kanban/revenda_kanban_colunas);
-- _comprado=false sempre (PL nao tem comprado), entao revenda_kanban_colunas e irrelevante.
--
-- O que cria (todas DEFINER + REVOKE dos 3):
--   _etapas_pl_cfg(_tenant uuid) RETURNS jsonb      -> {etapas_pl_automatico, etapas_pl_kanban, etapas_pl_requisitos}
--   _etapas_pl_ligado(_tenant uuid) RETURNS boolean -> le etapas_pl_automatico
--   _etapas_pl_derivar_lote(_tenant, _ids, _cfg)    -> espelho de _kanban_derivar_lote (board PL, elegivel = no PL)
--
-- RAISE 5xx so ASCII. Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261127100000_etapas_pl_cfg.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Trava: so catalogo (CREATE OR REPLACE FUNCTION), ms.
-- Volta: supabase/rollback/20261127100000_etapas_pl_cfg_down.sql (DROP das 3 funcoes NOVAS - DROP seguro).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   dependencias FIXADAS (nao redefinidas aqui):
--     public._kanban_fluxo(jsonb,boolean)                              7b3bbef69c25e08727553fb69c570fb4
--     public._kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean) 7f115cb6001b10b2daa52f13cd531b97
--     public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])            3715a292f9cd18a4b8eaa06601e114e9
-- ====================================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

-- Guarda: as dependencias reusadas tem o texto esperado (outra frente mexeu -> aborta, gere de novo).
DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._kanban_fluxo(jsonb,boolean)', '7b3bbef69c25e08727553fb69c570fb4'),
      ('public._kanban_derivar_puro(text[],jsonb,jsonb,jsonb,text,boolean)', '7f115cb6001b10b2daa52f13cd531b97'),
      ('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])', '3715a292f9cd18a4b8eaa06601e114e9')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'kpl_o2cfg: dependencia % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) config do board PL (espelho de _kanban_cfg, 20260930130000:359; so as chaves PL).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._etapas_pl_cfg(_tenant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'etapas_pl_automatico', coalesce(tc.etapas_pl_automatico, false),
    'etapas_pl_kanban',     coalesce(tc.etapas_pl_kanban, '[]'::jsonb),
    'etapas_pl_requisitos', coalesce(tc.etapas_pl_requisitos, '{}'::jsonb))
    FROM public.tenant_config tc
   WHERE tc.tenant_id = _tenant
   LIMIT 1;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) chave (espelho de _kanban_ligado, 20260930130000:379).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._etapas_pl_ligado(_tenant uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT tc.etapas_pl_automatico FROM public.tenant_config tc WHERE tc.tenant_id = _tenant LIMIT 1),
    false);
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) derivacao em LOTE do board PL (espelho de _kanban_derivar_lote, 20260930130000:394).
--    Diferencas do Dev:
--      - board UNICO: fluxo = _kanban_fluxo({status_kanban: etapas_pl_kanban}, false) para TODO modelo (sem cmp/revenda).
--      - reqs = etapas_pl_requisitos SEMPRE; excecoes = {} SEMPRE.
--      - elegivel = status_etapa_pl IS NOT NULL (esta no PL) - NAO ordem_criacao_enviada/lancado.
--      - status lido = m.status_etapa_pl; condicoes via _avaliar_condicoes_etapas_pl_core.
--    `_ids` NULL = a loja inteira (todos os que estao no PL). Uma linha por modelo pedido (nao derivavel ->
--    derivavel=false, resultado=status). O OFFSET 0 no LATERAL evita o planner replicar _kanban_derivar_puro por coluna.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._etapas_pl_derivar_lote(_tenant uuid, _ids uuid[], _cfg jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(modelo_id uuid, origem text, status_atual text, elegivel boolean, fluxo text[],
               reqs jsonb, exc jsonb, cond jsonb, derivavel boolean, entrada text, alvo text,
               resultado text, fixado boolean, primeira_falha text, faltando text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg   jsonb := coalesce(_cfg, public._etapas_pl_cfg(_tenant), '{}'::jsonb);
  v_fluxo text[];
  v_reqs  jsonb;
  v_ids   uuid[];
  v_cond  jsonb;
BEGIN
  -- board PL sob 'status_kanban' para a pura _kanban_fluxo (le status_kanban/revenda_kanban_colunas); _comprado=false.
  v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb)), false);
  v_reqs  := coalesce(v_cfg -> 'etapas_pl_requisitos', '{}'::jsonb);

  SELECT array_agg(m.id) INTO v_ids
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND (_ids IS NULL OR m.id = ANY (_ids))
     AND m.status_etapa_pl IS NOT NULL;
  v_cond := CASE WHEN v_ids IS NULL THEN '{}'::jsonb
                 ELSE coalesce(public._avaliar_condicoes_etapas_pl_core(_tenant, v_ids), '{}'::jsonb) END;

  RETURN QUERY
  WITH base AS (
    SELECT m.id AS mid,
           coalesce(m.origem, 'interno') AS org,
           m.status_etapa_pl::text AS st,
           (m.status_etapa_pl IS NOT NULL) AS eleg
      FROM public.modelos m
     WHERE m.tenant_id = _tenant
       AND (_ids IS NULL OR m.id = ANY (_ids))
  ), ent AS (
    SELECT b.*,
           v_fluxo AS fl,
           v_reqs  AS rq,
           '{}'::jsonb AS ex,
           coalesce(v_cond -> b.mid::text, '{}'::jsonb) AS cd
      FROM base b
  )
  SELECT e.mid, e.org, e.st, e.eleg, e.fl, e.rq, e.ex, e.cd,
         (x.d ->> 'derivavel')::boolean, x.d ->> 'entrada', x.d ->> 'alvo', x.d ->> 'resultado',
         (x.d ->> 'fixado')::boolean, x.d ->> 'primeiraFalha',
         ARRAY(SELECT f.v FROM jsonb_array_elements_text(x.d -> 'faltando') WITH ORDINALITY AS f(v, o) ORDER BY f.o)
    FROM ent e
    CROSS JOIN LATERAL (SELECT public._kanban_derivar_puro(e.fl, e.rq, e.ex, e.cd, e.st, e.eleg) AS d OFFSET 0) x;
END;
$function$;

-- Invariante #9 - internas sem EXECUTE p/ PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public._etapas_pl_cfg(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._etapas_pl_ligado(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._etapas_pl_derivar_lote(uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;

-- Pos-condicao: ACL (EXECUTE revogado dos 3), DEFINER, search_path=public nas 3 novas.
DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._etapas_pl_cfg(uuid)'),
      ('public._etapas_pl_ligado(uuid)'),
      ('public._etapas_pl_derivar_lote(uuid,uuid[],jsonb)')
    ) AS x(f) LOOP
    IF has_function_privilege('public', r.f, 'EXECUTE')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)
                        AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
      RAISE EXCEPTION 'kpl_o2cfg: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
