-- Volta da F7 Armario - Task C1: remove a RPC de leitura armario_variantes_disponiveis (nada mais; as tabelas ficam - volta da A1).
-- Rodar com o SITE ja voltado (o front novo chama a RPC). Idempotente.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DROP FUNCTION IF EXISTS public.armario_variantes_disponiveis(uuid, text, uuid);

NOTIFY pgrst, 'reload schema';
COMMIT;
