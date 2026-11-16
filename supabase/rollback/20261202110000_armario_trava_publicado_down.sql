-- Volta da migration 20261202110000 (F7 Armario: gatilho de trava "publicado"). Remove os 2 triggers e a funcao. Idempotente (IF EXISTS).
-- LIFO: volte esta ANTES de 20261202100000_armario_tabelas_down.sql. Sem perda de dado (so remove a regra).
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261202110000_armario_trava_publicado_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS trg_aaa_armario_trava ON public.armario_itens;
DROP TRIGGER IF EXISTS trg_aaa_armario_trava ON public.armarios;
DROP FUNCTION IF EXISTS public.fn_armario_trava_publicado();
COMMIT;
