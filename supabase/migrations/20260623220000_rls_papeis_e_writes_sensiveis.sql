-- Endurece RLS de papéis e writes sensíveis (decisões do dono):
--   * super_admin é a ÚNICA autoridade global; o papel `admin` legado não pode
--     ter poder cross-loja nem se auto-promover.
--   * writes de tenant_config e o rename/delete da própria loja exigem tenant_admin.
-- Impacto atual: 0 usuários `admin`/`tenant_admin` (só existe 1 super_admin), então
-- nenhuma sessão legítima é afetada — é puramente fechar brechas.

-- ============ user_roles: tira o poder do `admin` legado ============
-- "Admins can manage roles" (FOR ALL, has_role('admin')) NÃO tinha escopo de tenant
-- → qualquer admin geria roles de qualquer loja. As policies super_admin_* e
-- tenant_admin_user_roles já cobrem o gerenciamento legítimo.
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
-- Leitura cross-loja de roles por `admin` também é poder global indevido.
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;

-- no_self_role_assignment (RESTRICTIVE): o ramo has_role('admin') permitia que um
-- admin se auto-promovesse (inclusive a super_admin). Recria SEM esse ramo.
DROP POLICY IF EXISTS no_self_role_assignment ON public.user_roles;
CREATE POLICY no_self_role_assignment ON public.user_roles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((user_id <> auth.uid()) OR is_super_admin() OR is_tenant_admin())
  WITH CHECK ((user_id <> auth.uid()) OR is_super_admin() OR is_tenant_admin());

-- ============ tenant_config: write só por tenant_admin (ou super_admin) ============
-- Antes qualquer usuário do tenant dava UPDATE direto (modules, usa_pl, etc.),
-- furando o enforce de módulo. super_admin_all_tenant_config (já existe) cobre o super.
DROP POLICY IF EXISTS tenant_update ON public.tenant_config;
CREATE POLICY tenant_update ON public.tenant_config
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND is_tenant_admin())
  WITH CHECK (tenant_id = get_user_tenant_id() AND is_tenant_admin());

DROP POLICY IF EXISTS tenant_delete ON public.tenant_config;
CREATE POLICY tenant_delete ON public.tenant_config
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND is_tenant_admin());

-- ============ tenants: rename só por tenant_admin; delete só super_admin ============
DROP POLICY IF EXISTS "Update own tenant" ON public.tenants;
CREATE POLICY "Update own tenant" ON public.tenants
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (id = get_user_tenant_id() AND is_tenant_admin())
  WITH CHECK (id = get_user_tenant_id() AND is_tenant_admin());

-- "Delete own tenant" sem checagem de role permitia um usuário comum EXCLUIR a loja
-- (cascateando FKs). Removida — super_admin_all_tenants já cobre o delete legítimo.
DROP POLICY IF EXISTS "Delete own tenant" ON public.tenants;
