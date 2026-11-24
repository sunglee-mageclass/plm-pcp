-- Inverso de supabase/migrations/20261124100000_exportar_armario.sql (Exportar itens do Armario em CSV).
-- Objetos NOVOS: a volta e o DROP das 2 funcoes (wrapper primeiro, depois o _core). Nenhum dado e tocado (so leitura).
-- Ordem: SITE antes (o site novo chama a RPC). So catalogo; nada em auth/storage/realtime. Idempotente (IF EXISTS).
-- Aplicar fora de transacao de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DROP FUNCTION IF EXISTS public.exportar_armario(uuid);
DROP FUNCTION IF EXISTS public._exportar_armario_core(uuid, uuid);

COMMIT;
