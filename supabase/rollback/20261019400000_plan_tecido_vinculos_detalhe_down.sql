-- INVERSO de supabase/migrations/20261019400000_plan_tecido_vinculos_detalhe.sql (contas certas D5a, P-168 A).
-- Apaga as 2 funcoes novas, SO LEITURA: plan_tecido_vinculos_detalhe(uuid) e _plan_tecido_vinculos_detalhe_core(uuid,uuid).
-- Nenhum dado muda. O front D5b tolera a ausencia (erro -> lista vazia -> reparticao na ordem do array), mas o ideal e o
-- site voltar ANTES ou JUNTO. A RPC antiga plan_tecido_vinculos_modelo nao e tocada.
-- Guarda: so apaga se o texto vivo e o da ida (core 203e9d403a8f68055bf9c087ef5590b3, wrapper
-- 7ff16cd3559e8fb88b4b680643a1cbe5); outro -> P0001. Nenhuma das 2 existe -> P0001 (nada a desfazer). Sem DROP
-- TRIGGER/POLICY (DROP FUNCTION: so a trava de objeto da propria funcao). LIFO pela ordem de APLICACAO.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
BEGIN
  IF to_regprocedure('public.plan_tecido_vinculos_detalhe(uuid)') IS NULL
     OR to_regprocedure('public._plan_tecido_vinculos_detalhe_core(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_d5a (volta): as funcoes nao existem (ou so uma existe) - conferir antes' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_vinculos_detalhe_core(uuid,uuid)'))) IS DISTINCT FROM '203e9d403a8f68055bf9c087ef5590b3'
     OR md5(pg_get_functiondef(to_regprocedure('public.plan_tecido_vinculos_detalhe(uuid)'))) IS DISTINCT FROM '7ff16cd3559e8fb88b4b680643a1cbe5' THEN
    RAISE EXCEPTION 'contas_certas_d5a (volta): as funcoes nao estao com o texto da ida - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
END $volta$;

DROP FUNCTION public.plan_tecido_vinculos_detalhe(uuid);
DROP FUNCTION public._plan_tecido_vinculos_detalhe_core(uuid, uuid);

DO $pos$
BEGIN
  IF to_regprocedure('public.plan_tecido_vinculos_detalhe(uuid)') IS NOT NULL
     OR to_regprocedure('public._plan_tecido_vinculos_detalhe_core(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'contas_certas_d5a (volta): pos-condicao falhou' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
