-- Inverso de supabase/migrations/20261103176000_urg_r3_estoque_mov_log.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- NEUTRALIZA public.fn_estoque_mov_log() (CREATE OR REPLACE para RETURN NULL). Os 6 gatilhos de cad_aviamentos/cad_etiquetas e a tabela
-- public.estoque_mov_log FICAM, inertes: mudar o "a separar / a enviar" deixa de logar; as linhas ja gravadas ficam (o extrato da T14
-- segue lendo; a linha-base absorve o que o log nao explica). Sem DROP (DROP TRIGGER prende auth/storage/realtime: fica no _down_drop,
-- separado). Idempotente.
-- Volta LIFO: este arquivo vem DEPOIS do _down da 177000 (o extrato) e ANTES do 20261103175000_down.
-- Trava: SO catalogo (nenhuma trava de tabela - medido).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_estoque_mov_log()')));
  IF v IS NULL THEN
    RAISE EXCEPTION 'urg_r3_176000_down: public.fn_estoque_mov_log() nao existe - nada a voltar' USING ERRCODE = 'P0001';
  END IF;
  IF v NOT IN ('b50b96f26df262c55a4a9085e56bbb10', '910a696b98994505c5257369bb9df434') THEN
    RAISE EXCEPTION 'urg_r3_176000_down: public.fn_estoque_mov_log() com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_estoque_mov_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R3 T13] NEUTRALIZADA pelo _down da 20261103176000: os 6 gatilhos de cad_aviamentos/cad_etiquetas e a tabela
-- estoque_mov_log ficam, inertes (nada grava). Apagar de verdade = o _down_drop da mesma migration.
BEGIN
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_estoque_mov_log() FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_estoque_mov_log()'))) IS DISTINCT FROM '910a696b98994505c5257369bb9df434' THEN
    RAISE EXCEPTION 'urg_r3_176000_down: pos-condicao falhou (public.fn_estoque_mov_log() nao esta no texto neutro)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_estoque_mov_log()') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.fn_estoque_mov_log()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_estoque_mov_log()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.fn_estoque_mov_log()') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_176000_down: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public.fn_estoque_mov_log()' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
