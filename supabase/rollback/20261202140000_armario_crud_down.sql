-- Volta da F7 Armario - Task C3: remove as 6 RPCs de ciclo de vida (wrappers) + os 6 _core (nada mais; tabelas/gatilho/salvar/leitura ficam).
-- Rodar com o SITE ja voltado (o front novo chama as RPCs). Idempotente. Wrappers primeiro (eles chamam os _core).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DROP FUNCTION IF EXISTS public.armario_criar(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.armario_renomear(uuid, text);
DROP FUNCTION IF EXISTS public.armario_excluir(uuid);
DROP FUNCTION IF EXISTS public.armario_duplicar(uuid, text);
DROP FUNCTION IF EXISTS public.armario_reordenar(jsonb);
DROP FUNCTION IF EXISTS public.armario_status(uuid, text);
DROP FUNCTION IF EXISTS public._armario_criar_core(uuid, text, text, text);
DROP FUNCTION IF EXISTS public._armario_renomear_core(uuid, text);
DROP FUNCTION IF EXISTS public._armario_excluir_core(uuid);
DROP FUNCTION IF EXISTS public._armario_duplicar_core(uuid, text);
DROP FUNCTION IF EXISTS public._armario_reordenar_core(jsonb);
DROP FUNCTION IF EXISTS public._armario_status_core(uuid, text);

NOTIFY pgrst, 'reload schema';
COMMIT;
