
CREATE OR REPLACE FUNCTION public.is_tenant_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'tenant_admin'
  )
$$;

-- USERS: tenant_admin manages users of own tenant
DROP POLICY IF EXISTS "tenant_admin_users" ON public.users;
CREATE POLICY "tenant_admin_users" ON public.users
  FOR ALL TO authenticated
  USING (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id())
  WITH CHECK (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id());

-- USER_PERMISSIONS: tenant_admin manages perms in own tenant
DROP POLICY IF EXISTS "tenant_admin_user_permissions" ON public.user_permissions;
CREATE POLICY "tenant_admin_user_permissions" ON public.user_permissions
  FOR ALL TO authenticated
  USING (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id())
  WITH CHECK (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id());

-- USER_PERMISSIONS: each user can see their own permissions
DROP POLICY IF EXISTS "self_read_user_permissions" ON public.user_permissions;
CREATE POLICY "self_read_user_permissions" ON public.user_permissions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- USER_ROLES: tenant_admin can manage roles of users in same tenant (non super_admin only)
DROP POLICY IF EXISTS "tenant_admin_user_roles" ON public.user_roles;
CREATE POLICY "tenant_admin_user_roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (
    public.is_tenant_admin()
    AND role <> 'super_admin'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_roles.user_id AND u.tenant_id = public.get_user_tenant_id())
  )
  WITH CHECK (
    public.is_tenant_admin()
    AND role <> 'super_admin'
    AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = user_roles.user_id AND u.tenant_id = public.get_user_tenant_id())
  );
