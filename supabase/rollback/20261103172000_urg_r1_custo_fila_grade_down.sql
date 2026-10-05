-- Inverso de supabase/migrations/20261103172000_urg_r1_custo_fila_grade.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- NEUTRALIZA public.fn_custo_fila_grade() (CREATE OR REPLACE para RETURN NULL; o texto neutro nao cita a coluna nem os helpers da
-- 20261103170000, cujo _down_drop varre o prosrc). Os 3 gatilhos de modelo_grades FICAM, inertes: mudar a grade deixa de enfileirar o
-- custo. Sem DROP (DROP TRIGGER prende auth/storage/realtime: fica no _down_drop, separado). Custo previsto ja recalculado pela grade
-- FICA ate a proxima edicao do card. Idempotente.
-- Volta LIFO: este arquivo vem DEPOIS dos _down de 173000..178000 e ANTES do 20261103171000_down.
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
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_custo_fila_grade()')));
  IF v IS NULL THEN
    RAISE EXCEPTION 'urg_r1_172000_down: public.fn_custo_fila_grade() nao existe - nada a voltar' USING ERRCODE = 'P0001';
  END IF;
  IF v NOT IN ('6193e2458d9f566caa3b4ff7d0b6a551', '619e266e6dbbc469637802b8acf9920a') THEN
    RAISE EXCEPTION 'urg_r1_172000_down: public.fn_custo_fila_grade() com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_grade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R1 T4] NEUTRALIZADA pelo _down da 20261103172000: os 3 gatilhos de modelo_grades ficam, inertes (nada enfileira).
-- Apagar de verdade = o _down_drop da mesma migration.
BEGIN
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_grade() FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_custo_fila_grade()'))) IS DISTINCT FROM '619e266e6dbbc469637802b8acf9920a' THEN
    RAISE EXCEPTION 'urg_r1_172000_down: pos-condicao falhou (public.fn_custo_fila_grade() nao esta no texto neutro)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_custo_fila_grade()') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.fn_custo_fila_grade()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_custo_fila_grade()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.fn_custo_fila_grade()') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r1_172000_down: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public.fn_custo_fila_grade()' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
