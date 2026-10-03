-- INVERSO (passo 1 de 2) de supabase/migrations/20261030130000_integracao_api_loja_obrigatoria.sql (Release A2, P-224 B+).
-- NEUTRALIZA public._integracao_ler_loja: passa a SÓ delegar a public._integracao_ler, sem checar a loja (= o comportamento de
-- antes da A2: a chave decide a loja). CREATE OR REPLACE — sem trava de tabela, sem DROP; pode rodar a qualquer hora.
-- Ordem (LIFO): o SITE volta primeiro (o site velho chama _integracao_ler direto e nem usa esta função); este passo vem logo
-- depois e ANTES dos inversos da I3 (20261030120000/110000/100000). O CHECK ampliado e os registros 'loja_nao_autorizada' do Log
-- de acessos FICAM (inofensivos); tirá-los é o passo 2, SEPARADO e opcional:
-- supabase/rollback/20261030130000_integracao_api_loja_obrigatoria_down_drop.sql.
-- Guarda: a função tem de estar com o texto da ida (md5 d5bf36c5c1cefa550414e11db002efa7) ou já neutralizada
-- (md5 ccfa5fa7d3867203259c5dcc8039ca31) — idempotente.
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v text := md5(pg_get_functiondef(to_regprocedure('public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)')));
BEGIN
  IF v IS NULL OR v NOT IN ('d5bf36c5c1cefa550414e11db002efa7', 'ccfa5fa7d3867203259c5dcc8039ca31') THEN
    RAISE EXCEPTION 'a2_loja_volta: public._integracao_ler_loja ausente ou com texto inesperado (md5 %)', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_ler_loja(_chave_hash text, _loja uuid, _incluir_integrados boolean, _cursor text, _limite integer, _modo text, _ip text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- NEUTRALIZADA pelo inverso da 20261030130000 (Release A2): NAO checa a loja, so delega (a chave decide a loja, como antes).
  RETURN public._integracao_ler(_chave_hash, _incluir_integrados, _cursor, _limite, _modo, _ip);
END
$function$;

DO $pos$
DECLARE
  f text := 'public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)';
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure(f))) IS DISTINCT FROM 'ccfa5fa7d3867203259c5dcc8039ca31' THEN
    RAISE EXCEPTION 'a2_loja_volta: pos-condicao falhou (md5 %)', md5(pg_get_functiondef(to_regprocedure(f))) USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM aclexplode((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(f))) a
                 WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'a2_loja_volta: ACL inesperada em % (inv. 9)', f USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
