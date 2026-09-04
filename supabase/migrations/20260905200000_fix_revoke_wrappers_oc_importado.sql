-- FIX (review adversarial, menor): os wrappers da OC de importado não revogavam EXECUTE de
-- PUBLIC/anon (o Postgres concede a PUBLIC por padrão na criação). Alinha ao molde da revenda e ao
-- invariante #9 (defesa em profundidade — os _core já validam auth/tenant, mas o padrão é revogar).
-- Mantém o GRANT to authenticated. Idempotente.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.receber_oc_importado(uuid,jsonb,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.excluir_oc_importado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receber_oc_importado(uuid,jsonb,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_oc_importado(uuid) TO authenticated;

COMMIT;
