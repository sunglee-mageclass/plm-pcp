-- Inverso de supabase/migrations/20261103170000_urg_r1_insumo_tamanho_base.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- NO-OP DOCUMENTADO (plan-a Task 2): a coluna etiquetas.tamanho_vinculado e os 6 helpers FICAM, inertes - depois dos _down de
-- 171000..173000 nenhum consumidor os le, e o insumo sem vinculo nunca dependeu deles. Os vinculos gravados ficam na coluna (dado
-- que NAO volta sozinho). Remover de verdade = supabase/rollback/20261103170000_urg_r1_insumo_tamanho_base_down_drop.sql (opcional, depois, horario calmo).
-- Volta LIFO: este arquivo vem DEPOIS do 20261103170500_down (correcao do tamanho legado) e ANTES do 20261103161000_down (Camada).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $volta$
BEGIN
  RAISE NOTICE 'urg_r1_170000_down: no-op - coluna etiquetas.tamanho_vinculado e os 6 helpers ficam (inertes); DROP = _down_drop';
END
$volta$;

COMMIT;
