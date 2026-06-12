
-- 1) profiles: restrict SELECT to self
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 2) user_permissions: remove broad tenant_select / tenant_update / tenant_delete / tenant_insert
-- self_read_user_permissions + tenant_admin_user_permissions (ALL) cover the needed cases.
DROP POLICY IF EXISTS tenant_select ON public.user_permissions;
DROP POLICY IF EXISTS tenant_update ON public.user_permissions;
DROP POLICY IF EXISTS tenant_delete ON public.user_permissions;
DROP POLICY IF EXISTS tenant_insert ON public.user_permissions;

-- 3) users: restrict cross-tenant update to self or tenant_admin
DROP POLICY IF EXISTS "Update users same tenant" ON public.users;
CREATE POLICY "Users can update self"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Also tighten DELETE — was tenant-wide, restrict to tenant_admin (already covered by tenant_admin_users ALL, but drop the broad one).
DROP POLICY IF EXISTS "Delete users same tenant" ON public.users;

-- 4) Revoke EXECUTE on internal trigger/helper functions that should never be called by clients
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_tenant_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.artigos_recalc_preco() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_status_terceirizado() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gerar_parcelas_oc_tecido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.gerar_parcelas_oc_aviamento() FROM PUBLIC, anon, authenticated;

-- Keep EXECUTE on RLS helper functions (has_role, get_user_tenant_id, is_tenant_admin, is_super_admin)
-- for authenticated only; revoke from anon since policies are TO authenticated.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
