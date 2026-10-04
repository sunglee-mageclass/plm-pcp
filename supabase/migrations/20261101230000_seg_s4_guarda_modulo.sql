-- Reforço de segurança — sub-release S4 ("Brechas de módulo": C1 OTB, C2 Plan. Tecido). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s4.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S4, C1/C2) — REAVALIADO: sem CREATE POLICY (ver s4-report.md).
-- Gatilho trg_aaa_seg_modulo (BEFORE INSERT/UPDATE/DELETE, SECURITY INVOKER, so authenticated/anon) nas 12 tabelas do OTB
-- (modulo 'otb') e em colecao_mixes (modulo 'criacao'): loja com o modulo desligado nao grava nada, direto nem pelas RPCs
-- INVOKER. As 13 travas vem JUNTAS (LOCK TABLE, filhas antes das maes) em ate 1500ms (> deadlock_timeout: cancela
-- autovacuum), ate 3 tentativas atomicas. Nenhuma policy (nada em auth/storage/realtime).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_modulo_otb() (NOVA)
--     ANTES  ausente
--     DEPOIS 8fda935ba8d7703f03a1d093a00dcbdb
--     NEUTRA acec019a691a4dc33686b00af0770d07 (o _down)
--   public.fn_seg_modulo_criacao() (NOVA)
--     ANTES  ausente
--     DEPOIS a14a25c3e585a175174b73b6dc06a561
--     NEUTRA a9dc63bec99c49d8f7fb785757c3aa94 (o _down)
-- ====================================================================================
-- Trava: ShareRowExclusive SÓ nas 13 tabelas (bloqueia escrita, não leitura) até o COMMIT, pegas juntas; nada de
-- auth/storage/realtime (não há policy). Horário calmo. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101230000_seg_s4_guarda_modulo_down.sql (LIFO: 20261101230000_down → 220000_down, ANTES dos inversos da S3d/S3c/S3b/S3a).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_modulo_otb()', '8fda935ba8d7703f03a1d093a00dcbdb', 'acec019a691a4dc33686b00af0770d07'),
      ('public.fn_seg_modulo_criacao()', 'a14a25c3e585a175174b73b6dc06a561', 'a9dc63bec99c49d8f7fb785757c3aa94')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's4_guarda: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('colecao_mixes', 'public.fn_seg_modulo_criacao()'),
      ('colecao_pv_itens', 'public.fn_seg_modulo_otb()'),
      ('colecao_semana_categorias', 'public.fn_seg_modulo_otb()'),
      ('colecao_semanas', 'public.fn_seg_modulo_otb()'),
      ('colecao_subcolecoes', 'public.fn_seg_modulo_otb()'),
      ('mix_padrao_linhas', 'public.fn_seg_modulo_otb()'),
      ('mix_padroes', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_linhas', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_modelos', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_variantes', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_unidades', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacoes', 'public.fn_seg_modulo_otb()'),
      ('colecoes', 'public.fn_seg_modulo_otb()')
    ) AS x(t, f) LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_modulo'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's4_guarda: trg_aaa_seg_modulo em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_seg_modulo_otb()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s4] (Reforco de seguranca S4, C1) BRECHA DE MODULO na escrita das tabelas do OTB (colecoes, colecao_*, mix_padroes/_linhas, otb_simulacao*): com o modulo 'otb'
-- desligado na loja, o cliente nao grava nada (nem direto pela API, nem pelas RPCs SECURITY INVOKER, que gravam como ele).
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, que ja conferem o modulo), CASCADE de FK, migrations/psql e service_role passam. O super admin
-- passa (tenant_module_enabled devolve true para ele). Leitura (SELECT) nao e tocada: sem policy, o Realtime segue igual.
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT public.tenant_module_enabled('otb') THEN
    RAISE EXCEPTION 'Módulo otb não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_modulo_otb() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_modulo_criacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s4] (Reforco de seguranca S4, C1) BRECHA DE MODULO na escrita das tabelas colecao_mixes: com o modulo 'criacao'
-- desligado na loja, o cliente nao grava nada (nem direto pela API, nem pelas RPCs SECURITY INVOKER, que gravam como ele).
-- colecao_mixes = familias (mix) do Plan. Tecido/Plan. Produto/Produto Acabado/Importado (modulo Criacao), NAO do OTB.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, que ja conferem o modulo), CASCADE de FK, migrations/psql e service_role passam. O super admin
-- passa (tenant_module_enabled devolve true para ele). Leitura (SELECT) nao e tocada: sem policy, o Realtime segue igual.
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_modulo_criacao() FROM PUBLIC, anon, authenticated;

-- UMA tentativa ATÔMICA por vez (o padrão da S3d fix round): num sub-bloco, LOCK TABLE das 13 de uma vez (filhas antes das mães)
-- em até 1500ms (> deadlock_timeout: cancela autovacuum) e os 13 CREATE TRIGGER; 55P03/40P01 desfaz o sub-bloco e SOLTA TUDO
-- antes da pausa de 1s. Até 3 tentativas; depois, o erro aborta a transação (nada mudou).
DO $trg$
DECLARE
  i int;
BEGIN
  -- reaplicar com os gatilhos já criados não pega trava nenhuma (S5: nada de LOCK à toa numa txn que já mexeu em pg_class)
  IF NOT EXISTS (SELECT 1 FROM unnest(ARRAY['colecao_mixes', 'colecao_pv_itens', 'colecao_semana_categorias', 'colecao_semanas', 'colecao_subcolecoes', 'mix_padrao_linhas', 'mix_padroes', 'otb_simulacao_linhas', 'otb_simulacao_modelos', 'otb_simulacao_variantes', 'otb_simulacao_unidades', 'otb_simulacoes', 'colecoes']) x(t)
                  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || x.t)
                                     AND g.tgname = 'trg_aaa_seg_modulo' AND NOT g.tgisinternal)) THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.colecao_mixes, public.colecao_pv_itens, public.colecao_semana_categorias, public.colecao_semanas, public.colecao_subcolecoes, public.mix_padrao_linhas, public.mix_padroes, public.otb_simulacao_linhas, public.otb_simulacao_modelos, public.otb_simulacao_variantes, public.otb_simulacao_unidades, public.otb_simulacoes, public.colecoes IN SHARE ROW EXCLUSIVE MODE;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.colecao_mixes'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.colecao_mixes
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_criacao();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.colecao_pv_itens'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.colecao_pv_itens
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.colecao_semana_categorias'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.colecao_semana_categorias
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.colecao_semanas'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.colecao_semanas
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.colecao_subcolecoes'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.colecao_subcolecoes
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.mix_padrao_linhas'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.mix_padrao_linhas
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.mix_padroes'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.mix_padroes
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.otb_simulacao_linhas'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.otb_simulacao_linhas
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.otb_simulacao_modelos'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.otb_simulacao_modelos
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.otb_simulacao_variantes'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.otb_simulacao_variantes
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.otb_simulacao_unidades'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.otb_simulacao_unidades
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.otb_simulacoes'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.otb_simulacoes
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.colecoes'::regclass AND t.tgname = 'trg_aaa_seg_modulo'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_modulo BEFORE INSERT OR UPDATE OR DELETE ON public.colecoes
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_modulo_otb();
      END IF;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', '500ms', true);
END
$trg$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_modulo_otb()', '8fda935ba8d7703f03a1d093a00dcbdb', 'acec019a691a4dc33686b00af0770d07'),
      ('public.fn_seg_modulo_criacao()', 'a14a25c3e585a175174b73b6dc06a561', 'a9dc63bec99c49d8f7fb785757c3aa94')
    ) AS x(f, d, n) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 's4_guarda: pos-condicao falhou em %', r.f USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's4_guarda: pos-condicao falhou em % (EXECUTE ou SECURITY DEFINER)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('colecao_mixes', 'public.fn_seg_modulo_criacao()'),
      ('colecao_pv_itens', 'public.fn_seg_modulo_otb()'),
      ('colecao_semana_categorias', 'public.fn_seg_modulo_otb()'),
      ('colecao_semanas', 'public.fn_seg_modulo_otb()'),
      ('colecao_subcolecoes', 'public.fn_seg_modulo_otb()'),
      ('mix_padrao_linhas', 'public.fn_seg_modulo_otb()'),
      ('mix_padroes', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_linhas', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_modelos', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_variantes', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacao_unidades', 'public.fn_seg_modulo_otb()'),
      ('otb_simulacoes', 'public.fn_seg_modulo_otb()'),
      ('colecoes', 'public.fn_seg_modulo_otb()')
    ) AS x(t, f) LOOP
    -- tgtype 31 = ROW(1)+BEFORE(2)+INSERT(4)+DELETE(8)+UPDATE(16); sem colunas, sem WHEN; ligado ('O')
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_modulo'
                    AND t.tgfoid = to_regprocedure(r.f) AND t.tgtype = 31 AND t.tgenabled = 'O' AND t.tgqual IS NULL) THEN
      RAISE EXCEPTION 's4_guarda: pos-condicao falhou no gatilho de %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
