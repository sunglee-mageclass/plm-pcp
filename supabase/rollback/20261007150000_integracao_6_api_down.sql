-- Inverso de 20261007150000_integracao_6_api.sql — só DROP das 13 funções novas. Rodar PRIMEIRO na volta (LIFO).
-- Não apaga dado (chaves/acessos/log ficam até o inverso 1). A API passa a responder 500 (a rota chama função ausente).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_6_down: a migration 5 nao esta aplicada - estado inesperado' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._integracao_limpar(uuid);
DROP FUNCTION IF EXISTS public._integracao_confirmar(uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._integracao_ler(text, boolean, text, integer, text, text);
DROP FUNCTION IF EXISTS public.integracao_exemplo();
DROP FUNCTION IF EXISTS public.integracao_acessos_listar(integer);
DROP FUNCTION IF EXISTS public.integracao_chave_revogar(uuid);
DROP FUNCTION IF EXISTS public.integracao_chave_criar(text);
DROP FUNCTION IF EXISTS public.integracao_chaves_listar();
DROP FUNCTION IF EXISTS public.integracao_salvar_config_api(jsonb, integer);
DROP FUNCTION IF EXISTS public.integracao_salvar_config(text[], integer);
DROP FUNCTION IF EXISTS public._integracao_valores(public.integracao_linhas, text[], text[]);
DROP FUNCTION IF EXISTS public._integracao_exemplo(text[], integer);
DROP FUNCTION IF EXISTS public._integracao_colunas(text[]);

DO $pos$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('integracao_salvar_config', 'integracao_salvar_config_api',
     'integracao_chaves_listar', 'integracao_chave_criar', 'integracao_chave_revogar', 'integracao_acessos_listar',
     'integracao_exemplo', '_integracao_exemplo', '_integracao_colunas', '_integracao_valores', '_integracao_ler',
     '_integracao_confirmar', '_integracao_limpar');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'integracao_6_down: funcoes da migration 6 ainda existem (%)', v_n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
