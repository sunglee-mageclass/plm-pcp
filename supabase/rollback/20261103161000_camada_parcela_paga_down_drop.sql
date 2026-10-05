-- DROP opcional de supabase/migrations/20261103161000_camada_parcela_paga.sql - GERADO por .superpowers/sdd/2026-10-05-camada/mig/gerar-c1.mjs (nunca editar a mao). Rodar SO depois do 20261103161000_down, com o SITE ja
-- voltado, em HORARIO CALMO: DROP TRIGGER pega AccessExclusiveLock em producao_terceirizados por um instante E, em PRODUCAO
-- (supautils.policy_grants), prende ~23 tabelas auth/storage/realtime ate o COMMIT (login/upload esperam) - transacao
-- curtissima, horario calmo. (A copia local nao tem supautils: a medicao dos testes nao enxerga isso.)
-- Guarda: a funcao tem de estar NEUTRA (ou ausente).
--   public.fn_servico_parcela_paga_bloqueia_delete()  IDA f819e2f2059019539de03dd179721611  NEUTRO 7a6dd9a7e13c300569c162808081bf7f
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';
DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()')));
  IF v IS NOT NULL AND v <> '7a6dd9a7e13c300569c162808081bf7f' THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down_drop: public.fn_servico_parcela_paga_bloqueia_delete() nao esta NEUTRA (md5 %) - rode o 20261103161000_down antes', v
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_servico_parcela_paga_bloqueia_delete ON public.producao_terceirizados;
DROP FUNCTION IF EXISTS public.fn_servico_parcela_paga_bloqueia_delete();

DO $pos$
BEGIN
  IF to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_servico_parcela_paga_bloqueia_delete') THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down_drop: pos-condicao falhou' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
