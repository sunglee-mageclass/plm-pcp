-- Volta da F7 Armario - Task C2: remove a RPC de escrita armario_salvar (wrapper) + _armario_salvar_core (nada mais; tabelas/gatilho ficam).
-- Rodar com o SITE ja voltado (o front novo chama a RPC). Idempotente. Wrapper primeiro (ele chama o _core).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DROP FUNCTION IF EXISTS public.armario_salvar(uuid, uuid, text, text, text, integer, text, jsonb);
DROP FUNCTION IF EXISTS public._armario_salvar_core(uuid, uuid, text, text, text, integer, text, jsonb);

NOTIFY pgrst, 'reload schema';
COMMIT;
