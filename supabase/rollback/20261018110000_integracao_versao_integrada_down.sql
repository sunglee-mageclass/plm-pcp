-- INVERSO de 20261018110000_integracao_versao_integrada (T5 — "Versão de produto já integrado") — GERADO por
-- .superpowers/sdd/2026-09-30-preco-anterior/mig/gerar_t5.py. Sem dado (RPC só-leitura): só DROP FUNCTION.
-- LIFO: roda ANTES do inverso da 20261018100000 (que recusa enquanto esta RPC existir). O FRONT volta antes (com o banco
-- velho o front novo só deixa de mostrar o aviso: PGRST202 -> nada).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.integracao_versoes_integradas(uuid[])')));
  IF v IS DISTINCT FROM '8576ce537ede3ebbf041f6f6739f475a' THEN
    RAISE EXCEPTION 'versao_integrada (volta): integracao_versoes_integradas nao esta no texto da ida (md5 %) - outra frente mexeu ou a volta ja rodou', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.integracao_versoes_integradas(uuid[]);

DO $pos$
BEGIN
  IF to_regprocedure('public.integracao_versoes_integradas(uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'versao_integrada (volta): pos-condicao - a funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
