-- Segurança (invariante 9): _salvar_cq_pos_core/_desmarcar_cq_pos_core ficaram executáveis
-- por anon/authenticated — a migration anterior fez REVOKE FROM PUBLIC, que NÃO remove os
-- grants que o pg_default_acl do Supabase concede a anon/authenticated em toda função nova.
-- Assim um usuário autenticado podia chamar o _core DIRETO, furando o gate de módulo do
-- wrapper (tenant_module_enabled). Revoga de anon+authenticated (padrão correto).
REVOKE EXECUTE ON FUNCTION public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._desmarcar_cq_pos_core(uuid) FROM anon, authenticated;
