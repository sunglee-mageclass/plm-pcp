-- DROP opcional de supabase/migrations/20261103178000_urg_r3_audit_registro_idx.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- !! FORA DE TRANSACAO (DROP INDEX CONCURRENTLY): psql -v ON_ERROR_STOP=1 -f <este arquivo>; sem BEGIN/COMMIT de proposito.
-- Apaga public.idx_audit_log_registro (valido ou INVALIDO) so se a definicao for a da ida (indice homonimo de outra frente = recusa).
-- Trava: ShareUpdateExclusiveLock em public.audit_log + espera as transacoes abertas (nao bloqueia escrita). lock_timeout 1500ms
-- (55P03 = nada mudou, rodar de novo). Idempotente. Vem ANTES do _down_drop da 20261103177000 (LIFO).
SET client_encoding = 'UTF8';
SET lock_timeout = '1500ms';

DO $guarda$
DECLARE
  r record;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) AS def, i.indrelid INTO r
    FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_audit_log_registro');
  IF FOUND AND (r.indrelid <> 'public.audit_log'::regclass OR r.def IS DISTINCT FROM 'CREATE INDEX idx_audit_log_registro ON public.audit_log USING btree (registro_id) WHERE (registro_id IS NOT NULL)') THEN
    RAISE EXCEPTION 'urg_r3_178000_down_drop: public.idx_audit_log_registro com OUTRA definicao (%) - nada apagado', r.def USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP INDEX CONCURRENTLY IF EXISTS public.idx_audit_log_registro;

DO $pos$
BEGIN
  IF to_regclass('public.idx_audit_log_registro') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r3_178000_down_drop: pos-condicao falhou (public.idx_audit_log_registro ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

RESET lock_timeout;
