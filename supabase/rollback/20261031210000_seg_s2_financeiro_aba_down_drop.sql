-- DROP separado de supabase/migrations/20261031210000_seg_s2_financeiro_aba.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s2.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S2, RESPOSTAS DO DONO).
-- Apaga o gatilho trg_parcela_permissao e a funcao fn_parcela_permissao (que o _down deixou NEUTRA).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_servico_parcela_valor_pago()
--     ANTES  de9914b310477de1331f076a874696f1
--     DEPOIS b81d725dc25994eae29e7dfa8337f621
--   public.fn_parcela_permissao() (NOVA)
--     ANTES  ausente
--     DEPOIS f52b8d610577554a756fc2125844e5b2
--     NEUTRA d532e403362f93bcee9240f4c15bc840 (o _down)
-- ====================================================================================
-- ⚠️ TRAVA: DROP TRIGGER/DROP FUNCTION como postgres → AccessExclusive em parcelas E (supautils) em ~23 tabelas de
-- auth/storage/realtime até o COMMIT. SÓ em horário calmo, transação curtíssima. Nunca junto da ida de outra release.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text := md5(pg_get_functiondef(to_regprocedure('public.fn_parcela_permissao()')));
BEGIN
  IF v IS NOT NULL AND v IS DISTINCT FROM 'd532e403362f93bcee9240f4c15bc840' THEN
    RAISE EXCEPTION 's2_finaba_down_drop: rode antes o _down (fn_parcela_permissao ainda confere a permissao; md5 %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_parcela_permissao ON public.parcelas;
DROP FUNCTION IF EXISTS public.fn_parcela_permissao();

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regprocedure('public.fn_parcela_permissao()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.parcelas'::regclass AND t.tgname = 'trg_parcela_permissao') THEN
    RAISE EXCEPTION 's2_finaba_down_drop: pos-condicao falhou (gatilho ou funcao ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
