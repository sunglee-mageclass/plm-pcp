-- Inverso de 20261007120000_integracao_3_estados.sql — só DROP das 6 funções novas. Rodar SÓ depois do inverso 4 (LIFO).
-- Não apaga dado (integracao_produtos/linhas/log ficam até o inverso 1).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_integracao_trava_modelos()') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_3_down: volte a migration 4 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.integracao_log_listar(integer);
DROP FUNCTION IF EXISTS public.integracao_desfazer(uuid, text);
DROP FUNCTION IF EXISTS public.integracao_voltar(uuid[]);
DROP FUNCTION IF EXISTS public.integracao_marcar(jsonb);
DROP FUNCTION IF EXISTS public._integracao_logar(uuid, text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public._integracao_quem();

DO $pos$
BEGIN
  IF to_regprocedure('public.integracao_marcar(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_3_down: funcoes da migration 3 ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
