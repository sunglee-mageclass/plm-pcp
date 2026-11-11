BEGIN;
DROP FUNCTION IF EXISTS public._audit_evento_secao(uuid,uuid,text,text,jsonb);
COMMIT;
