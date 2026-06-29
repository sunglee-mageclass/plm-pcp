-- Bug: o super_admin GRAVAVA permissões (server fn via service-role) mas NÃO as RELIA
-- no modal (cliente normal com RLS). user_permissions só tinha policies tenant_admin_*
-- e self_read — faltava a de super_admin. Resultado: salvava e funcionava, mas os
-- checkboxes voltavam vazios ao reabrir.
-- Fix: policy super_admin (FOR ALL), espelhando super_admin_all_users da tabela users.
DROP POLICY IF EXISTS "super_admin_user_permissions" ON public.user_permissions;
CREATE POLICY "super_admin_user_permissions" ON public.user_permissions
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
