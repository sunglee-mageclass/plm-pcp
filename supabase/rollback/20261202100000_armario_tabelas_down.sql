-- Volta da migration 20261202100000 (F7 Armario: tabelas `armarios` + `armario_itens`). LIFO: itens (filha) antes do armario.
-- DESTRUTIVA: apaga TODOS os armarios e itens (dado de vitrine; nao ha backfill). Idempotente (IF EXISTS). Ordem de deploy: volte o SITE
-- antes do banco. Se a Task A2 (gatilho de trava) ou as RPCs (C1/C2...) ja estiverem aplicadas, volte-as ANTES desta (dependem das tabelas).
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261202100000_armario_tabelas_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TABLE IF EXISTS public.armario_itens;
DROP TABLE IF EXISTS public.armarios;
SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
