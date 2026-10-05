-- Urgentes R3 T14 (Ruling A22) - indice parcial em public.audit_log(registro_id) para o Extrato de estoque (20261103177000), que
-- busca a ULTIMA transicao de cada OC/CAD/OS (status -> recebido, enviado_corte -> true, baixado -> true) por registro_id; sem ele cada
-- chamada varre o audit da loja inteira. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- !! FORA DE TRANSACAO: CREATE INDEX CONCURRENTLY recusa bloco de transacao. Rodar SOZINHO: psql -v ON_ERROR_STOP=1 -f <este arquivo>
-- (NUNCA -1/--single-transaction; NUNCA \i dentro de BEGIN). Sem BEGIN/COMMIT de proposito.
-- Trava: ShareUpdateExclusiveLock em public.audit_log (NAO bloqueia leitura nem escrita - o fn_audit segue gravando; bloqueia so
-- VACUUM/ANALYZE/outro DDL na tabela) durante a construcao; espera as transacoes abertas terminarem (fases 2/3 do CONCURRENTLY).
-- lock_timeout 1500ms: 55P03 ANTES da construcao = nada mudou, rodar de novo; 55P03/cancelamento NO MEIO deixa o indice INVALIDO
-- (a guarda/pos-condicao avisam) - saida: supabase/rollback/20261103178000_urg_r3_audit_registro_idx_down_drop.sql e este arquivo de novo. Qualquer hora; conferir pg_index.indisvalid
-- no fim (a pos-condicao recusa se invalido). Idempotente (IF NOT EXISTS + guarda da definicao).
-- Definicao exigida: CREATE INDEX idx_audit_log_registro ON public.audit_log USING btree (registro_id) WHERE (registro_id IS NOT NULL)
-- Volta (LIFO): supabase/rollback/20261103178000_urg_r3_audit_registro_idx_down.sql (no-op: o indice fica) - ANTES do 20261103177000_down. DROP de verdade: supabase/rollback/20261103178000_urg_r3_audit_registro_idx_down_drop.sql
-- (DROP INDEX CONCURRENTLY, fora de transacao, opcional) - ANTES do _down_drop da 177000.
SET client_encoding = 'UTF8';
SET lock_timeout = '1500ms';

DO $guarda$
DECLARE
  r record;
BEGIN
  IF (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
       WHERE a.attrelid = 'public.audit_log'::regclass AND a.attname = 'registro_id' AND NOT a.attisdropped) IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'urg_r3_178000: public.audit_log.registro_id nao e uuid?!' USING ERRCODE = 'P0001';
  END IF;
  SELECT i.indisvalid AS valido, pg_get_indexdef(i.indexrelid) AS def, i.indrelid INTO r
    FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_audit_log_registro');
  IF FOUND THEN
    IF r.indrelid <> 'public.audit_log'::regclass OR r.def IS DISTINCT FROM 'CREATE INDEX idx_audit_log_registro ON public.audit_log USING btree (registro_id) WHERE (registro_id IS NOT NULL)' THEN
      RAISE EXCEPTION 'urg_r3_178000: ja existe public.idx_audit_log_registro com OUTRA definicao (%) - nada mudou', r.def USING ERRCODE = 'P0001';
    END IF;
    IF NOT r.valido THEN
      RAISE NOTICE 'urg_r3_178000: public.idx_audit_log_registro existe e esta INVALIDO (CREATE CONCURRENTLY interrompido) - o CREATE abaixo o PULA e a pos-condicao recusa; saida: rodar supabase/rollback/20261103178000_urg_r3_audit_registro_idx_down_drop.sql e este arquivo de novo';
    END IF;
  END IF;
END
$guarda$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_log_registro ON public.audit_log (registro_id) WHERE registro_id IS NOT NULL;

DO $pos$
DECLARE
  r record;
BEGIN
  SELECT i.indisvalid AS valido, pg_get_indexdef(i.indexrelid) AS def INTO r
    FROM pg_index i WHERE i.indexrelid = to_regclass('public.idx_audit_log_registro');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'urg_r3_178000: pos-condicao falhou - public.idx_audit_log_registro nao existe' USING ERRCODE = 'P0001';
  END IF;
  IF r.def IS DISTINCT FROM 'CREATE INDEX idx_audit_log_registro ON public.audit_log USING btree (registro_id) WHERE (registro_id IS NOT NULL)' THEN
    RAISE EXCEPTION 'urg_r3_178000: pos-condicao falhou - definicao inesperada (%)', r.def USING ERRCODE = 'P0001';
  END IF;
  IF NOT r.valido THEN
    RAISE EXCEPTION 'urg_r3_178000: public.idx_audit_log_registro INVALIDO (pg_index.indisvalid = false) - saida: rodar supabase/rollback/20261103178000_urg_r3_audit_registro_idx_down_drop.sql e este arquivo de novo' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

RESET lock_timeout;
