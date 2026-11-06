-- Inverso de 20261112100000_plan_tecido_reescrever_vinculo_oc.sql (funcoes novas: so DROP).
BEGIN;
DROP FUNCTION IF EXISTS public.plan_tecido_reescrever_vinculo_oc(uuid,uuid[]);
DROP FUNCTION IF EXISTS public._plan_tecido_reescrever_vinculo_oc_core(uuid,uuid,uuid[]);
NOTIFY pgrst, 'reload schema';
COMMIT;
