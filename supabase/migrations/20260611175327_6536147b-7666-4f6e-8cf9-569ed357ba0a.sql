GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin() TO authenticated, anon, service_role;