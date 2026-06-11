
-- Helper function: is current user a super_admin?
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  )
$$;

-- TENANTS: super_admin full access
DROP POLICY IF EXISTS "super_admin_all_tenants" ON public.tenants;
CREATE POLICY "super_admin_all_tenants" ON public.tenants
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- USERS: super_admin full access
DROP POLICY IF EXISTS "super_admin_all_users" ON public.users;
CREATE POLICY "super_admin_all_users" ON public.users
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- USER_ROLES: super_admin can manage all
DROP POLICY IF EXISTS "super_admin_all_user_roles" ON public.user_roles;
CREATE POLICY "super_admin_all_user_roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
