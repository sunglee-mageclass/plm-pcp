-- Kanban PL configuravel - Onda 2, Task 8 (ULTIMA): CHAVE protegida `etapas_pl_automatico` + RPC do botao + snapshot/restaurar.
-- ADITIVA e idempotente (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, CREATE TRIGGER guardado). SO BANCO; com
-- etapas_pl_automatico=false (default) TUDO e inerte: nenhum snapshot, nada move. Nenhuma tela usa ainda (a frente so liga na Onda 3).
--
-- Espelha o Dev (copia viva, nao a migration original):
--   - fn_etapas_pl_chave_protegida   <- fn_kanban_chave_protegida (20260930140000:502) + trg (:520), SO a parte da chave
--   - fn_etapas_pl_config            <- fn_kanban_config (20260930140000:535) + trg_kanban_config
--   - etapas_pl_snapshot             <- kanban_snapshot (20260930120000:50)
--   - etapas_pl_definir_automatico   <- kanban_definir_automatico (20260930150000:234)
--   - etapas_pl_previa_restauracao   <- kanban_previa_restauracao (:325)
--   - etapas_pl_restaurar            <- kanban_restaurar (:446)
-- ⚠️ NOME PROPRIO da trava: `fn_kanban_chave_protegida` JA serve a 2 travas (kanban_automatico + MOD-1 `modules`); esta e uma
-- TERCEIRA, separada, e SO toca NEW.etapas_pl_automatico (nenhuma outra coluna - nem `modules`, nem `kanban_automatico`).
--
-- Trocas: kanban_automatico->etapas_pl_automatico; status_desenvolvimento->status_etapa_pl; GUCs app.kanban_chave/_sistema/_lote
-- -> app.etapas_pl_chave/_sistema/_lote; _kanban_ligado/_kanban_aplicar -> _etapas_pl_ligado/_etapas_pl_aplicar;
-- modelo_kanban_historico -> modelo_etapa_pl_historico; gatilho do kanban `status_kanban/kanban_requisitos/...` ->
-- `etapas_pl_kanban/etapas_pl_requisitos`.
--
-- Decisoes de espelho (diferencas deliberadas do Dev):
--   - A trava deixa passar quem NAO vem por JWT de usuario (migration/psql/service_role; auth.uid() nulo e role fora de
--     authenticated/anon) - o Dev so deixa passar pela GUC; aqui segue o ruling do controlador e a regra MOD-1 (a barreira e contra
--     PostgREST/aba velha/salvar_config_loja, que sempre chegam com claims). A GUC app.etapas_pl_chave='rpc' passa de qualquer jeito.
--     Quem esta barrado tem a MUDANCA IGNORADA (sem erro): UPDATE -> mantem o valor antigo; INSERT -> nasce false.
--   - GATE DE LIGAR: etapas_pl_definir_automatico(true) RECUSA board PL vazio (P0001 ASCII `etapas_pl_board_vazio`). Motivo:
--     _kanban_fluxo('[]') cai no board PADRAO do Dev (14 colunas) - ligar com board vazio moveria cards contra colunas do Dev.
--     Defesa em profundidade: fn_etapas_pl_config tambem NAO snapshota nem aplica com board vazio. Desligar nunca checa board.
--   - Elegivel p/ snapshot/restaurar = status_etapa_pl IS NOT NULL (o PROPRIO status e a elegibilidade, ver Task 6); no Dev e
--     ordem_criacao_enviada AND NOT lancado. Restaurar NAO reinsere no PL um card que SAIU do PL depois (status NULL) - conta no aviso.
--   - Gate das RPCs: login + _exige_modulos('producao','etapas_pl') + admin da loja/super (no Dev: modulo criacao).
--   - mensagens de RAISE em ASCII (5xx do PostgREST derruba o code com nao-ASCII); textos de `avisos` (dado) mantem acento.
--
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261127130000_etapas_pl_chave.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Trava: CREATE TRIGGER pega ShareRowExclusive em `tenant_config`
-- (bloqueia ESCRITA por ms; lock_timeout 1500ms -> 55P03 = nada mudou, rodar de novo; horario calmo). O CREATE TRIGGER NAO
-- prende auth/storage (so o DROP TRIGGER em tenant_config prende - ver o _down_drop); por isso a criacao e GUARDADA (IF NOT EXISTS
-- em pg_trigger), nunca DROP+CREATE (reference_policy_ddl_trava_auth).
-- Volta: supabase/rollback/20261127130000_etapas_pl_chave_down.sql (NEUTRALIZA as funcoes; sem DROP) e
-- opcional/separado ..._down_drop.sql (DROP triggers + tabela + funcoes, HORARIO CALMO).
-- Todas as funcoes sao NOVAS: nao ha guarda de md5 de funcao redefinida; a guarda abaixo confere so a PURA reusada.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   dependencias FIXADAS (nao redefinidas aqui):
--     public._kanban_fluxo(jsonb,boolean)                                     7b3bbef69c25e08727553fb69c570fb4
-- ====================================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._kanban_fluxo(jsonb,boolean)')));
  IF v IS DISTINCT FROM '7b3bbef69c25e08727553fb69c570fb4' THEN
    RAISE EXCEPTION 'kpl_o2ch: dependencia _kanban_fluxo(jsonb,boolean) com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._etapas_pl_cfg(uuid)'),
      ('public._etapas_pl_ligado(uuid)'),
      ('public._etapas_pl_aplicar(uuid,uuid[],text,uuid)'),
      ('public._exige_modulos(text[])'),
      ('public.is_tenant_admin()'),
      ('public.is_super_admin()'),
      ('public.get_user_tenant_id()')
    ) AS x(f) LOOP
    IF to_regprocedure(r.f) IS NULL THEN
      RAISE EXCEPTION 'kpl_o2ch: dependencia % ausente (aplique a Sessao A/Onda 1 antes)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public.modelo_etapa_pl_historico') IS NULL THEN
    RAISE EXCEPTION 'kpl_o2ch: modelo_etapa_pl_historico ausente (aplique a Sessao A antes)' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenant_config'
         AND column_name IN ('etapas_pl_automatico', 'etapas_pl_kanban', 'etapas_pl_requisitos')) <> 3 THEN
    RAISE EXCEPTION 'kpl_o2ch: colunas etapas_pl_* de tenant_config ausentes (aplique a Onda 1 antes)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Tabela etapas_pl_snapshot - colunas de ANTES de ligar/mudar a config (restaurar com previa). Espelho de kanban_snapshot.
--    RLS ligada SEM policy + REVOKE ALL: so as RPCs DEFINER leem/escrevem (invariante #9).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.etapas_pl_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id         uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  modelo_id       uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  status_anterior text,
  motivo          text NOT NULL CONSTRAINT etapas_pl_snapshot_motivo_chk CHECK (motivo IN ('ligar', 'config')),
  criado_at       timestamptz NOT NULL DEFAULT now(),
  restaurado_at   timestamptz,
  CONSTRAINT etapas_pl_snapshot_lote_modelo_uk UNIQUE (lote_id, modelo_id)
);
CREATE INDEX IF NOT EXISTS idx_etapas_pl_snapshot_tenant ON public.etapas_pl_snapshot (tenant_id, criado_at DESC);
CREATE INDEX IF NOT EXISTS idx_etapas_pl_snapshot_modelo ON public.etapas_pl_snapshot (modelo_id);
ALTER TABLE public.etapas_pl_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.etapas_pl_snapshot FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Trava da chave (BEFORE INSERT OR UPDATE em tenant_config). Espelho de fn_kanban_chave_protegida, SO a parte da chave.
--    Passa: GUC app.etapas_pl_chave='rpc' (so etapas_pl_definir_automatico seta) OU chamada SEM JWT de usuario
--    (migration/psql/service_role). Senao a mudanca de etapas_pl_automatico e IGNORADA (sem erro; as outras colunas gravam).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_chave_protegida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.etapas_pl_chave', true), '') = 'rpc' THEN
    RETURN NEW;
  END IF;
  -- sem JWT de usuario (migration/psql) e service_role: passam (a barreira e contra PostgREST/aba velha/salvar_config_loja).
  IF auth.uid() IS NULL AND coalesce(auth.role(), '') NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.etapas_pl_automatico := false;
  ELSIF NEW.etapas_pl_automatico IS DISTINCT FROM OLD.etapas_pl_automatico THEN
    NEW.etapas_pl_automatico := OLD.etapas_pl_automatico;
  END IF;
  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Config mudou com a chave LIGADA -> snapshot + aplica (AFTER UPDATE). Espelho de fn_kanban_config.
--    Board PL vazio: sai sem snapshot nem aplicar (o fluxo cairia no board PADRAO do Dev).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ligou     boolean := coalesce(NEW.etapas_pl_automatico, false) AND NOT coalesce(OLD.etapas_pl_automatico, false);
  v_cfg_mudou boolean;
  v_lote      uuid;
  v_agora     timestamptz := clock_timestamp();  -- relogio (nao now()): separa, na MESMA txn, o antes/depois do lote
BEGIN
  IF NEW.tenant_id IS NULL OR NOT coalesce(NEW.etapas_pl_automatico, false) THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(NEW.etapas_pl_kanban) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.etapas_pl_kanban) = 0 THEN
    RETURN NULL;
  END IF;
  v_cfg_mudou := OLD.etapas_pl_kanban IS DISTINCT FROM NEW.etapas_pl_kanban
    OR OLD.etapas_pl_requisitos IS DISTINCT FROM NEW.etapas_pl_requisitos;
  IF v_ligou OR v_cfg_mudou THEN
    v_lote := gen_random_uuid();
    INSERT INTO public.etapas_pl_snapshot (lote_id, tenant_id, modelo_id, status_anterior, motivo, criado_at)
    SELECT v_lote, NEW.tenant_id, m.id, m.status_etapa_pl,
           CASE WHEN v_ligou THEN 'ligar' ELSE 'config' END, v_agora
      FROM public.modelos m
     WHERE m.tenant_id = NEW.tenant_id
       AND m.status_etapa_pl IS NOT NULL;
  END IF;
  PERFORM public._etapas_pl_aplicar(NEW.tenant_id, NULL, 'config', v_lote);
  RETURN NULL;
END;
$function$;

-- Gatilhos: criacao GUARDADA, sem DROP (DROP TRIGGER em tenant_config prende auth/storage ate o COMMIT -
-- reference_policy_ddl_trava_auth). Criar so se faltar nao prende nada.
DO $kpl8a$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.tenant_config'::regclass
       AND tgname = 'trg_etapas_pl_chave_protegida'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_etapas_pl_chave_protegida '
         || 'BEFORE INSERT OR UPDATE ON public.tenant_config '
         || 'FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_chave_protegida()';
  END IF;
END
$kpl8a$;

DO $kpl8b$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.tenant_config'::regclass
       AND tgname = 'trg_etapas_pl_config'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_etapas_pl_config '
         || 'AFTER UPDATE ON public.tenant_config '
         || 'FOR EACH ROW WHEN ((old.etapas_pl_automatico IS DISTINCT FROM new.etapas_pl_automatico) '
         || 'OR (old.etapas_pl_kanban IS DISTINCT FROM new.etapas_pl_kanban) '
         || 'OR (old.etapas_pl_requisitos IS DISTINCT FROM new.etapas_pl_requisitos)) '
         || 'EXECUTE FUNCTION public.fn_etapas_pl_config()';
  END IF;
END
$kpl8b$;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) etapas_pl_definir_automatico - o BOTAO da chave. A UNICA porta de etapas_pl_automatico (GUC app.etapas_pl_chave='rpc'
--    em volta do UPDATE, RESTAURADA depois). Ligar: RECUSA board PL vazio; snapshota + move os cards (trg_etapas_pl_config).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.etapas_pl_definir_automatico(_ligar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_chave_ant text := coalesce(current_setting('app.etapas_pl_chave', true), '');
  v_antes     boolean;
  v_depois    boolean;
  v_inicio    timestamptz := clock_timestamp();
  v_lote      uuid;
  v_snap      integer := 0;
  v_mov       integer := 0;
  v_board     jsonb;
  v_fluxo     text[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login necessario' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('producao', 'etapas_pl');
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'sem_permissao: apenas o administrador da loja liga ou desliga o kanban automatico das etapas' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'loja_inativa: operacao nao permitida' USING ERRCODE = '42501';
  END IF;
  IF _ligar IS NULL THEN
    RAISE EXCEPTION 'etapas_pl_param: informe se o kanban automatico das etapas deve ser ligado ou desligado' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.etapas_pl_automatico INTO v_antes
    FROM public.tenant_config tc
   WHERE tc.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: config_loja' USING ERRCODE = 'P0002';
  END IF;

  -- GATE de ligar: board PL vazio (ou sem 1a etapa nomeada) cairia no board PADRAO do Dev (_kanban_fluxo('[]') = 14 colunas).
  IF _ligar THEN
    v_board := public._etapas_pl_cfg(v_tenant) -> 'etapas_pl_kanban';
    IF jsonb_typeof(v_board) IS DISTINCT FROM 'array' OR jsonb_array_length(v_board) = 0 THEN
      RAISE EXCEPTION 'etapas_pl_board_vazio: configure as etapas antes de ligar' USING ERRCODE = 'P0001';
    END IF;
    v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', v_board), false);
    IF cardinality(v_fluxo) = 0 OR nullif(btrim(v_fluxo[1]), '') IS NULL THEN
      RAISE EXCEPTION 'etapas_pl_board_vazio: configure as etapas antes de ligar' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_antes IS DISTINCT FROM _ligar THEN
    PERFORM set_config('app.etapas_pl_chave', 'rpc', true);
    UPDATE public.tenant_config SET etapas_pl_automatico = _ligar WHERE tenant_id = v_tenant;
    PERFORM set_config('app.etapas_pl_chave', v_chave_ant, true);
  END IF;

  SELECT tc.etapas_pl_automatico INTO v_depois FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;

  IF _ligar AND v_antes IS DISTINCT FROM _ligar THEN
    SELECT s.lote_id, count(*)::integer INTO v_lote, v_snap
      FROM public.etapas_pl_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.criado_at >= v_inicio
     GROUP BY s.lote_id
     ORDER BY max(s.criado_at) DESC
     LIMIT 1;
    IF v_lote IS NOT NULL THEN
      SELECT count(DISTINCT h.modelo_id)::integer INTO v_mov
        FROM public.modelo_etapa_pl_historico h
       WHERE h.tenant_id = v_tenant AND h.lote_id = v_lote AND h.origem = 'config';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ligado', v_depois,
    'mudou', v_antes IS DISTINCT FROM v_depois,
    'lote_id', v_lote,
    'snapshot', coalesce(v_snap, 0),
    'cards_movidos', coalesce(v_mov, 0));
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) etapas_pl_previa_restauracao - admin; NAO grava. `_lote_id` NULL = o lote 'ligar' mais recente ainda nao restaurado.
--    Espelho de kanban_previa_restauracao (sem 'lancados'; troca por 'saiu_do_pl').
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.etapas_pl_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_lote      uuid;
  v_motivo    text;
  v_criado    timestamptz;
  v_restaur   timestamptz;
  v_ligada    boolean;
  v_saiu      integer;
  v_superados integer := 0;
  v_out       jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login necessario' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('producao', 'etapas_pl');
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'sem_permissao: apenas o administrador da loja restaura as colunas das etapas' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'loja_inativa: operacao nao permitida' USING ERRCODE = '42501';
  END IF;

  v_lote := coalesce(_lote_id, (
    SELECT s.lote_id FROM public.etapas_pl_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.restaurado_at IS NULL
     ORDER BY s.criado_at DESC, s.lote_id DESC LIMIT 1));
  v_ligada := public._etapas_pl_ligado(v_tenant);
  IF v_lote IS NULL THEN
    RETURN jsonb_build_object('lote_id', NULL, 'chave_ligada', v_ligada, 'total', 0, 'voltam', 0,
      'movidos_depois', 0, 'lotes_superados', 0, 'cards', '[]'::jsonb,
      'avisos', jsonb_build_array('Não há colunas guardadas para restaurar.'));
  END IF;

  SELECT min(s.motivo), min(s.criado_at), max(s.restaurado_at) INTO v_motivo, v_criado, v_restaur
    FROM public.etapas_pl_snapshot s
   WHERE s.lote_id = v_lote AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: lote_etapas_pl' USING ERRCODE = 'P0002';
  END IF;

  -- lotes MAIS NOVOS (criado_at, lote_id) nao restaurados da loja: restaurar este os SUPERA (mesma regra de etapas_pl_restaurar).
  IF v_restaur IS NULL THEN
    SELECT count(DISTINCT s.lote_id) INTO v_superados
      FROM public.etapas_pl_snapshot s
     WHERE s.tenant_id = v_tenant
       AND s.restaurado_at IS NULL
       AND s.lote_id <> v_lote
       AND (s.criado_at, s.lote_id) > (v_criado, v_lote);
  END IF;

  SELECT count(*) INTO v_saiu
    FROM public.etapas_pl_snapshot s
    JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
   WHERE s.lote_id = v_lote AND m.status_etapa_pl IS NULL;

  WITH s AS (
    SELECT s.modelo_id, s.status_anterior, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib,
           m.status_etapa_pl AS status_atual,
           EXISTS (SELECT 1 FROM public.modelo_etapa_pl_historico h
                    WHERE h.modelo_id = s.modelo_id AND h.origem = 'manual' AND h.created_at > v_criado) AS manual_depois
      FROM public.etapas_pl_snapshot s
      JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
     WHERE s.lote_id = v_lote
       AND m.status_etapa_pl IS NOT NULL
  )
  SELECT jsonb_build_object(
    'lote_id', v_lote, 'motivo', v_motivo, 'criado_at', v_criado, 'restaurado_at', v_restaur,
    'chave_ligada', v_ligada, 'lotes_superados', v_superados,
    'total', (SELECT count(*) FROM s),
    'voltam', (SELECT count(*) FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior),
    'movidos_depois', (SELECT count(*) FROM s WHERE s.manual_depois AND s.status_atual IS DISTINCT FROM s.status_anterior),
    'cards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'modelo_id', s.modelo_id, 'nome', s.nome, 'ref', s.ref_exib,
               'de', s.status_atual, 'para', s.status_anterior, 'movido_manual_depois', s.manual_depois)
             ORDER BY s.nome, s.modelo_id)
        FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior), '[]'::jsonb),
    'avisos', to_jsonb(array_remove(ARRAY[
      CASE WHEN v_ligada THEN 'Desligue o kanban automático das etapas antes de restaurar (senão o próximo salvamento refaz as colunas).' END,
      CASE WHEN v_restaur IS NOT NULL THEN 'Este lote já foi restaurado.' END,
      CASE WHEN v_superados > 0 THEN v_superados || ' ajuste(s) de configuração feitos depois de ligar serão desfeitos junto.' END,
      CASE WHEN v_saiu > 0 THEN v_saiu || ' card(s) saiu(íram) do quadro depois e não voltam.' END
    ], NULL)))
  INTO v_out;
  RETURN v_out;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6) etapas_pl_restaurar - admin; exige a chave DESLIGADA (senao o proximo evento desfaria). Espelho de kanban_restaurar.
--    Ordem de travas: tenant_config -> snapshot -> modelos. So restaura card que AINDA esta no PL (status NOT NULL).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.etapas_pl_restaurar(_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_sis_ant   text := coalesce(current_setting('app.etapas_pl_sistema', true), '');
  v_lote_ant  text := coalesce(current_setting('app.etapas_pl_lote', true), '');
  v_criado    timestamptz;
  v_restaur   timestamptz;
  v_hist      integer := 0;
  v_n         integer := 0;
  v_superados integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: login necessario' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('producao', 'etapas_pl');
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'sem_permissao: apenas o administrador da loja restaura as colunas das etapas' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'loja_inativa: operacao nao permitida' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM public.tenant_config WHERE tenant_id = v_tenant FOR UPDATE;
  PERFORM 1 FROM public.etapas_pl_snapshot WHERE lote_id = _lote_id AND tenant_id = v_tenant FOR UPDATE;

  IF public._etapas_pl_ligado(v_tenant) THEN
    RAISE EXCEPTION 'etapas_pl_ligado: desligue o kanban automatico das etapas antes de restaurar' USING ERRCODE = 'P0001';
  END IF;

  SELECT min(s.criado_at), max(s.restaurado_at) INTO v_criado, v_restaur
    FROM public.etapas_pl_snapshot s
   WHERE s.lote_id = _lote_id AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: lote_etapas_pl' USING ERRCODE = 'P0002';
  END IF;
  IF v_restaur IS NOT NULL THEN
    RAISE EXCEPTION 'etapas_pl_lote_restaurado: este lote ja foi restaurado' USING ERRCODE = 'P0001';
  END IF;

  -- restaurar L SUPERA os lotes MAIS NOVOS nao restaurados da loja (ex.: o lote 'config' de um ajuste feito com a chave ligada).
  WITH sup AS (
    UPDATE public.etapas_pl_snapshot s
       SET restaurado_at = now()
     WHERE s.tenant_id = v_tenant
       AND s.restaurado_at IS NULL
       AND s.lote_id <> _lote_id
       AND (s.criado_at, s.lote_id) > (v_criado, _lote_id)
    RETURNING s.lote_id
  )
  SELECT count(DISTINCT sup.lote_id) INTO v_superados FROM sup;

  -- trava os modelos do lote ANTES do DELETE (ordem tenant_config -> snapshot -> modelos; ORDER BY p/ ordem fixa).
  PERFORM 1
     FROM public.modelos m
     JOIN public.etapas_pl_snapshot s ON s.modelo_id = m.id
    WHERE s.lote_id = _lote_id AND m.tenant_id = v_tenant
    ORDER BY m.id
      FOR NO KEY UPDATE OF m;

  PERFORM set_config('app.etapas_pl_sistema', 'restauracao', true);
  PERFORM set_config('app.etapas_pl_lote', _lote_id::text, true);

  DELETE FROM public.modelo_etapa_pl_historico h
   USING public.etapas_pl_snapshot s
   JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
   WHERE s.lote_id = _lote_id
     AND h.modelo_id = s.modelo_id
     AND h.tenant_id = v_tenant
     AND h.origem IN ('auto', 'config')
     AND h.created_at >= v_criado
     AND m.status_etapa_pl IS NOT NULL;
  GET DIAGNOSTICS v_hist = ROW_COUNT;

  UPDATE public.modelos m
     SET status_etapa_pl = s.status_anterior
    FROM public.etapas_pl_snapshot s
   WHERE s.lote_id = _lote_id
     AND m.id = s.modelo_id
     AND m.tenant_id = v_tenant
     AND m.status_etapa_pl IS NOT NULL
     AND m.status_etapa_pl IS DISTINCT FROM s.status_anterior;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.etapas_pl_snapshot SET restaurado_at = now()
   WHERE lote_id = _lote_id AND tenant_id = v_tenant;

  PERFORM set_config('app.etapas_pl_sistema', v_sis_ant, true);
  PERFORM set_config('app.etapas_pl_lote', v_lote_ant, true);
  RETURN jsonb_build_object('lote_id', _lote_id, 'restaurados', v_n, 'historico_apagado', v_hist,
                            'lotes_superados', v_superados);
END;
$function$;

-- Invariante #9 - as 2 funcoes de gatilho sem EXECUTE para ninguem; as 3 RPCs so para authenticated.
REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_chave_protegida() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_config() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_definir_automatico(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_definir_automatico(boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_previa_restauracao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_previa_restauracao(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_restaurar(uuid) TO authenticated;

-- Pos-condicao: ACL, DEFINER, search_path=public; tabela com RLS sem policy e sem grant; gatilhos presentes e habilitados.
DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_etapas_pl_chave_protegida()'),
      ('public.fn_etapas_pl_config()')
    ) AS x(f) LOOP
    IF has_function_privilege('public', r.f, 'EXECUTE') OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION 'kpl_o2ch: pos-condicao falhou - % com EXECUTE aberto', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.etapas_pl_definir_automatico(boolean)'),
      ('public.etapas_pl_previa_restauracao(uuid)'),
      ('public.etapas_pl_restaurar(uuid)')
    ) AS x(f) LOOP
    IF has_function_privilege('public', r.f, 'EXECUTE') OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION 'kpl_o2ch: pos-condicao falhou - ACL de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_etapas_pl_chave_protegida()'),
      ('public.fn_etapas_pl_config()'),
      ('public.etapas_pl_definir_automatico(boolean)'),
      ('public.etapas_pl_previa_restauracao(uuid)'),
      ('public.etapas_pl_restaurar(uuid)')
    ) AS x(f) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
      RAISE EXCEPTION 'kpl_o2ch: pos-condicao falhou - % sem secdef/search_path=public', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.etapas_pl_snapshot'::regclass AND c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.etapas_pl_snapshot'::regclass)
     OR has_table_privilege('anon', 'public.etapas_pl_snapshot', 'SELECT')
     OR has_table_privilege('authenticated', 'public.etapas_pl_snapshot', 'SELECT') THEN
    RAISE EXCEPTION 'kpl_o2ch: pos-condicao falhou - etapas_pl_snapshot (RLS sem policy + sem grant)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES ('trg_etapas_pl_chave_protegida'), ('trg_etapas_pl_config')) AS x(t) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = 'public.tenant_config'::regclass AND t.tgname = r.t
                      AND NOT t.tgisinternal AND t.tgenabled = 'O') THEN
      RAISE EXCEPTION 'kpl_o2ch: pos-condicao falhou - gatilho % ausente/desabilitado', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
