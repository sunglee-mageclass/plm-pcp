-- Block self-update of tenant_id (privilege escalation fix)
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

  IF auth.uid() = OLD.id
     AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND NOT public.is_super_admin()
  THEN
    RAISE EXCEPTION 'Não é permitido alterar o próprio tenant';
  END IF;

  RETURN NEW;
END;
$$;