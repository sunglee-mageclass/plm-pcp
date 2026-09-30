-- INVERSO de supabase/migrations/20261019220000_parcela_voltar_vencimento_automatico.sql (P-171 A).
-- Apaga a RPC parcela_voltar_vencimento_automatico(uuid). O front que mostra "Voltar ao calculo automatico" tem de voltar
-- ANTES ou JUNTO (senao o botao da erro "funcao nao existe" - nada e gravado). Parcelas que a acao ja devolveu ao
-- calculado ficam como estao (vencimento_manual = false, data recalculada) - o historico esta no audit_log.
-- Guarda: so apaga se o texto vivo e o da ida (md5 82677bf24887f6e1ad7caadfa920ae45); outro -> P0001. Sem DROP TRIGGER (DROP FUNCTION: medido, so a
-- trava de objeto da propria funcao). LIFO: vem ANTES das voltas da 20261019210000/20261019200000.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
BEGIN
  IF to_regprocedure('public.parcela_voltar_vencimento_automatico(uuid)') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_p171 (volta): a funcao nao existe - nada a desfazer' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public.parcela_voltar_vencimento_automatico(uuid)'::regprocedure)) IS DISTINCT FROM '82677bf24887f6e1ad7caadfa920ae45' THEN
    RAISE EXCEPTION 'contas_certas_p171 (volta): a funcao nao esta com o texto da ida - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
END $volta$;

DROP FUNCTION public.parcela_voltar_vencimento_automatico(uuid);

NOTIFY pgrst, 'reload schema';
COMMIT;
