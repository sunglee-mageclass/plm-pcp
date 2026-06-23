-- Invariante 5 (Fase 0/1): EXECUTE revogado de anon nas SECURITY DEFINER. Estes 7
-- wrappers de escrita foram recriados via CREATE OR REPLACE e voltaram a ter o GRANT
-- default a PUBLIC (inclui anon). Não é explorável (os corpos checam auth.uid()),
-- mas restaura a blindagem: só authenticated executa.
REVOKE EXECUTE ON FUNCTION public.salvar_cad_completo(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_cad_completo(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_cq(uuid, jsonb, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_cq(uuid, jsonb, jsonb, jsonb, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.desmarcar_cq(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.desmarcar_cq(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.enviar_modelo_para_cad(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enviar_modelo_para_cad(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_acabamento(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_acabamento(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_direcionamento(uuid, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_direcionamento(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_terceirizados(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_terceirizados(uuid, jsonb, text) TO authenticated;
