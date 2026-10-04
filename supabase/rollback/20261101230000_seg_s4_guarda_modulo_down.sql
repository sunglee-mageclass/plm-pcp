-- Inverso de supabase/migrations/20261101230000_seg_s4_guarda_modulo.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s4.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S4, C1/C2) — REAVALIADO: sem CREATE POLICY (ver s4-report.md).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422).
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
-- Trava: só catálogo. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
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
  -- LIFO (fix round S4): a S5 (20261101240000) guarda a ACL destas tabelas; com ela no banco, PARE (volte a S5 antes).
  IF to_regprocedure('public.tenant_module_enabled(text)') IS NOT NULL
     AND NOT has_function_privilege('anon', 'public.tenant_module_enabled(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 's4_guarda_down: rode antes a volta da S5 20261101240000_down (a faxina de privilegios ainda esta no banco)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_modulo_otb()', '8fda935ba8d7703f03a1d093a00dcbdb', 'acec019a691a4dc33686b00af0770d07'),
      ('public.fn_seg_modulo_criacao()', 'a14a25c3e585a175174b73b6dc06a561', 'a9dc63bec99c49d8f7fb785757c3aa94')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's4_guarda_down: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 's4_guarda_down: trg_aaa_seg_modulo em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- os gatilhos FICAM (inertes): as funções viram neutras (sem DROP — o DROP prende auth/storage, vai no _down_drop separado)
CREATE OR REPLACE FUNCTION public.fn_seg_modulo_otb()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s4] NEUTRALIZADA pelo inverso (_down): os gatilhos trg_aaa_seg_modulo seguem nas tabelas, mas nao conferem nada.
-- O DROP dos gatilhos e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_seg_modulo_criacao()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s4] NEUTRALIZADA pelo inverso (_down): os gatilhos trg_aaa_seg_modulo seguem nas tabelas, mas nao conferem nada.
-- O DROP dos gatilhos e desta funcao fica no _down_drop separado (DROP TRIGGER prende auth/storage ate o COMMIT: horario calmo).
BEGIN
  RETURN COALESCE(NEW, OLD);
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_modulo_otb()', '8fda935ba8d7703f03a1d093a00dcbdb', 'acec019a691a4dc33686b00af0770d07'),
      ('public.fn_seg_modulo_criacao()', 'a14a25c3e585a175174b73b6dc06a561', 'a9dc63bec99c49d8f7fb785757c3aa94')
    ) AS x(f, d, n) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's4_guarda_down: pos-condicao falhou em % (esperado o texto neutro)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
