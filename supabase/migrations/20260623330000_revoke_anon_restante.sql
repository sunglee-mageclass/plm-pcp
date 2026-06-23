-- Bug (severidade baixa) achado nos 100 testes: 3 funcoes de escrita + 5 RPCs de
-- dashboard ainda concediam EXECUTE a anon (inconsistencia do hardening anterior).
-- Nao explotavel (guard de runtime + REVOKE em get_user_tenant_id bloqueiam antes de
-- gravar), mas alinha com o invariante 5. REVOKE de PUBLIC/anon + GRANT a authenticated.
REVOKE EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.criar_rolo(text, uuid, jsonb, uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.criar_rolo(text, uuid, jsonb, uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_modelo_bom(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.salvar_modelo_bom(uuid, jsonb, jsonb, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_colecao(date, date, text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dashboard_colecao(date, date, text, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_custos(date, date, text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dashboard_custos(date, date, text, uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_estoque() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dashboard_estoque() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_financeiro(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dashboard_financeiro(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_producao(date, date, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.dashboard_producao(date, date, text, uuid) TO authenticated;
