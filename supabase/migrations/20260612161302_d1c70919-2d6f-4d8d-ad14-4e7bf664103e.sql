
-- 1) Revogar EXECUTE público (anon + PUBLIC) de todas as SECURITY DEFINER funções do schema public
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_colecao(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_estoque() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_producao() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_financeiro() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_custos(text, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ocs_disponiveis_variante(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.detalhe_estoque_variante(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.saldo_oc_item_m(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.recalcular_parcelas(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid) FROM PUBLIC, anon;

-- 2) Funções de trigger / helpers internos: somente service_role/postgres
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.artigos_recalc_preco() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_status_terceirizado() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gerar_parcelas_oc_tecido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gerar_parcelas_oc_aviamento() FROM PUBLIC, anon, authenticated;

-- 3) Garantir explicit DENY de auto-escalada em user_roles
-- Política restritiva que bloqueia qualquer INSERT/UPDATE onde o alvo seja o próprio usuário tentando se promover
DROP POLICY IF EXISTS "no_self_role_assignment" ON public.user_roles;
CREATE POLICY "no_self_role_assignment" ON public.user_roles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (
    -- Para SELECT/DELETE/UPDATE existentes: o usuário só pode operar em si mesmo se for admin/super_admin
    user_id <> auth.uid()
    OR public.is_super_admin()
    OR public.is_tenant_admin()
    OR public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    -- Para INSERT/UPDATE: impedir o usuário de criar/alterar um papel para si mesmo, exceto se já for admin
    user_id <> auth.uid()
    OR public.is_super_admin()
    OR public.is_tenant_admin()
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );
