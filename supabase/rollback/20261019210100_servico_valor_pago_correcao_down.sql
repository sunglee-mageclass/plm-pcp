-- INVERSO de supabase/migrations/20261019210100_servico_valor_pago_correcao.sql (correcao unica A2).
-- Volta a NULL o valor_pago SO das parcelas guardadas em public._bkp_cc_a2_valor_pago que ainda estao pagas e com o
-- MESMO valor gravado pela correcao (a tela volta a mostrar a formula antiga para elas - fallback do helper). Apaga a lista.
-- Usa a GUC app.servico_valor_pago_correcao = 'on' so nesta transacao (senao o gatilho manteria o valor antigo).
-- Auditada: o UPDATE passa pelo audit_parcelas_servico (fn_audit). A tabela _bkp_cc_a2_valor_pago fica (vazia).
-- LIFO: vem ANTES da volta da 20261019210000. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

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
  IF to_regclass('public._bkp_cc_a2_valor_pago') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_a2_correcao (volta): _bkp_cc_a2_valor_pago nao existe - a correcao nao foi aplicada' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_lista FROM public._bkp_cc_a2_valor_pago;
  LOCK TABLE public.parcelas_servico IN SHARE ROW EXCLUSIVE MODE;
  PERFORM set_config('app.servico_valor_pago_correcao', 'on', true);
  UPDATE public.parcelas_servico ps SET valor_pago = NULL
    FROM public._bkp_cc_a2_valor_pago b
   WHERE ps.id = b.parcela_id AND ps.valor_pago = b.valor_pago
     AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.servico_valor_pago_correcao', '', true);
  DELETE FROM public._bkp_cc_a2_valor_pago;
  RAISE NOTICE 'contas_certas_a2_correcao (volta): % de % parcela(s) voltaram a valor_pago NULL', v_n, v_lista;
END $volta$;

COMMIT;
