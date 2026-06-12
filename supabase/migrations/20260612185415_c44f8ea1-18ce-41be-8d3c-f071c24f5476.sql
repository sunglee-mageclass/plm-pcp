
-- 1. Prevent users from self-updating their role column
CREATE OR REPLACE FUNCTION public.prevent_users_self_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = OLD.id
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NOT (public.is_super_admin() OR public.is_tenant_admin())
  THEN
    RAISE EXCEPTION 'Não é permitido alterar o próprio role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_prevent_self_role_change ON public.users;
CREATE TRIGGER users_prevent_self_role_change
BEFORE UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_users_self_role_change();

-- 2. Tenant-scope reads on tenant-logos bucket (path = {tenant_id}/...)
DROP POLICY IF EXISTS "tenant_logos_read" ON storage.objects;
CREATE POLICY "tenant_logos_read" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'tenant-logos'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);

-- 3. Revoke EXECUTE from anon on all SECURITY DEFINER functions in public
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_financeiro() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_custos(text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_producao() FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_colecao(uuid, uuid, integer, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_estoque() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ocs_disponiveis_variante(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.detalhe_estoque_variante(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.recalcular_parcelas(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.saldo_oc_item_m(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.baixar_estoque_tecido_corte(uuid) FROM anon;
