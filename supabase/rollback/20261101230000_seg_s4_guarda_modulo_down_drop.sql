-- DROP separado de supabase/migrations/20261101230000_seg_s4_guarda_modulo.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s4.mjs (nunca editar à mão). OPCIONAL, depois do _down.
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S4, C1/C2) — REAVALIADO: sem CREATE POLICY (ver s4-report.md).
-- Apaga os 13 gatilhos trg_aaa_seg_modulo e as 2 funcoes (o _down as deixou NEUTRAS).
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
-- ⚠️ TRAVA: DROP TRIGGER/DROP FUNCTION como postgres → AccessExclusive nas 13 tabelas E (supautils) em ~23 tabelas de
-- auth/storage/realtime até o COMMIT. SÓ em horário calmo, transação curtíssima.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL transaction_timeout = '10s';

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
    IF v IS NOT NULL AND v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 's4_guarda_down_drop: rode antes o _down (% ainda confere o modulo; md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.colecao_mixes;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.colecao_pv_itens;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.colecao_semana_categorias;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.colecao_semanas;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.colecao_subcolecoes;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.mix_padrao_linhas;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.mix_padroes;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.otb_simulacao_linhas;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.otb_simulacao_modelos;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.otb_simulacao_variantes;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.otb_simulacao_unidades;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.otb_simulacoes;
DROP TRIGGER IF EXISTS trg_aaa_seg_modulo ON public.colecoes;
DROP FUNCTION IF EXISTS public.fn_seg_modulo_otb();
DROP FUNCTION IF EXISTS public.fn_seg_modulo_criacao();

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_aaa_seg_modulo')
     OR to_regprocedure('public.fn_seg_modulo_otb()') IS NOT NULL
     OR to_regprocedure('public.fn_seg_modulo_criacao()') IS NOT NULL THEN
    RAISE EXCEPTION 's4_guarda_down_drop: pos-condicao falhou (gatilho ou funcao ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
