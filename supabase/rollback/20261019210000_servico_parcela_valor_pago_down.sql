-- INVERSO de supabase/migrations/20261019210000_servico_parcela_valor_pago.sql (contas certas A2, fin #5). Ordem RD1:
--   1) restaura servicos_financeiro com o texto EXATO de antes (copia em public._bkp_funcoes_contas_certas): volta a
--      calcular o valor de TODA parcela pela formula (inclusive as pagas) e a esconder a paga de bloco inativo/interno;
--   2) DEPOIS desliga o gatilho trg_servico_parcela_valor_pago (DISABLE TRIGGER - o DROP TRIGGER trava auth/storage no
--      Supabase). NAO apaga a coluna valor_pago (guarda o valor pago congelado - RD1, aposentar = ocultar primeiro), nem o
--      helper _servico_parcelas_valores, nem a funcao do gatilho. Reaplicar a ida religa.
-- Se a correcao unica 20261019210100 foi aplicada, desfaca-a ANTES (LIFO).
-- Guarda: so roda se servicos_financeiro esta EXATAMENTE com o texto da ida (md5 daec320c497c283929b33b55303aba89).
-- Ordem geral: LIFO da APLICACAO. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
DECLARE
  v_sig text;
  v_md5 text;
  v_def text;
  v_md5_antes text;
BEGIN
  IF to_regclass('public._bkp_funcoes_contas_certas') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_a2 (volta): _bkp_funcoes_contas_certas nao existe - a 20261019210000 nao foi aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- public.servicos_financeiro()
  v_sig := 'public.servicos_financeiro()';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'contas_certas_a2 (volta): % nao existe', v_sig USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM 'daec320c497c283929b33b55303aba89' THEN
    RAISE EXCEPTION 'contas_certas_a2 (volta): % nao esta com o texto da 20261019210000 (md5 %) - nada a desfazer ou outra frente mexeu', v_sig, v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT b.definicao, b.md5 INTO v_def, v_md5_antes FROM public._bkp_funcoes_contas_certas b
   WHERE b.migracao = '20261019210000' AND b.assinatura = v_sig;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contas_certas_a2 (volta): copia do texto de antes de % nao encontrada em _bkp_funcoes_contas_certas', v_sig USING ERRCODE = 'P0001';
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(to_regprocedure(v_sig))) IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'contas_certas_a2 (volta): % nao voltou ao texto guardado', v_sig USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public._bkp_funcoes_contas_certas WHERE migracao = '20261019210000';

END $volta$;

REVOKE EXECUTE ON FUNCTION public.servicos_financeiro() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.servicos_financeiro() TO authenticated;

-- gatilho DEPOIS da funcao (RD1)
DO $gatilho$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_servico_parcela_valor_pago'
             AND tgrelid = 'public.parcelas_servico'::regclass AND tgenabled <> 'D') THEN
    ALTER TABLE public.parcelas_servico DISABLE TRIGGER trg_servico_parcela_valor_pago;
  END IF;
END $gatilho$;

NOTIFY pgrst, 'reload schema';
COMMIT;
