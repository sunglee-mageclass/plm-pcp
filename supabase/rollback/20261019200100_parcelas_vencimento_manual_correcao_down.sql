-- INVERSO de supabase/migrations/20261019200100_parcelas_vencimento_manual_correcao.sql (correcao unica A1).
-- Desmarca (vencimento_manual = false) SO as parcelas guardadas em public._bkp_cc_a1_vencimento_manual cujo vencimento
-- AINDA e o do momento da correcao (se a pessoa ajustou a data de novo depois, a marca e dela e fica). Apaga a lista.
-- Auditada: o UPDATE passa pelo audit_parcelas (fn_audit). A tabela _bkp_cc_a1_vencimento_manual fica (vazia).
-- LIFO: vem ANTES da volta da 20261019200000. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
DECLARE
  v_n int;
  v_lista int;
BEGIN
  IF to_regclass('public._bkp_cc_a1_vencimento_manual') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_a1_correcao (volta): _bkp_cc_a1_vencimento_manual nao existe - a correcao nao foi aplicada' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_lista FROM public._bkp_cc_a1_vencimento_manual;
  LOCK TABLE public.parcelas IN SHARE ROW EXCLUSIVE MODE;
  UPDATE public.parcelas p SET vencimento_manual = false
    FROM public._bkp_cc_a1_vencimento_manual b
   WHERE p.id = b.parcela_id AND p.vencimento_manual AND p.data_vencimento = b.data_vencimento;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM public._bkp_cc_a1_vencimento_manual;
  RAISE NOTICE 'contas_certas_a1_correcao (volta): % de % parcela(s) desmarcada(s)', v_n, v_lista;
END $volta$;

COMMIT;
