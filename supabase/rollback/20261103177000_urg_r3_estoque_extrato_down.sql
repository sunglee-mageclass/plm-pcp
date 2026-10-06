-- Inverso de supabase/migrations/20261103177000_urg_r3_estoque_extrato.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- NO-OP DOCUMENTADO: as 6 funcoes do extrato sao SO LEITURA e o site velho nao as chama - ficam (inertes) depois da volta do site.
-- Apagar de verdade = supabase/rollback/20261103177000_urg_r3_estoque_extrato_down_drop.sql (opcional, depois). Volta LIFO: este arquivo vem ANTES do 20261103176000_down.
-- Trava: nenhuma.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $nada$
BEGIN
  RAISE NOTICE 'urg_r3_177000_down: no-op - as 6 funcoes do extrato (so leitura) ficam; apagar = o _down_drop';
END
$nada$;

COMMIT;
