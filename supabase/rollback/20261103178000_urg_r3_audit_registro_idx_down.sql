-- Inverso de supabase/migrations/20261103178000_urg_r3_audit_registro_idx.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- NO-OP DOCUMENTADO: o indice so acelera a leitura do Extrato; nada grava por ele nem depende dele - FICA. Apagar de verdade =
-- supabase/rollback/20261103178000_urg_r3_audit_registro_idx_down_drop.sql (opcional, depois, fora de transacao). Volta LIFO: este arquivo vem ANTES do 20261103177000_down.
-- Trava: nenhuma.
SET client_encoding = 'UTF8';
DO $nada$
BEGIN
  RAISE NOTICE 'urg_r3_178000_down: no-op - o indice public.idx_audit_log_registro fica; apagar = o _down_drop (DROP INDEX CONCURRENTLY)';
END
$nada$;
