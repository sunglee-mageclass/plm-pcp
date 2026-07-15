-- Permissões de usuário atômicas (audit de saúde jul/2026).
-- ANTES: as server functions savePermissions (tenant-admin) e savePermissionsAsSuperAdmin (super)
-- faziam DELETE + INSERT em user_permissions em duas chamadas separadas — se o INSERT falhava
-- depois do DELETE, o usuário ficava SEM NENHUMA permissão. Fix: RPC única (a função é 1 txn) com
-- authz própria (super_admin OU tenant_admin da própria loja) + validação de que o alvo é da loja.

CREATE OR REPLACE FUNCTION public.set_user_permissions(_user_id uuid, _tenant_id uuid, _perms jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  -- Authz: super_admin escolhe a loja (_tenant_id); tenant_admin só a própria.
  IF public.is_super_admin() THEN
    v_tenant := _tenant_id;
  ELSIF public.is_tenant_admin() THEN
    v_tenant := public.get_user_tenant_id();
  ELSE
    RAISE EXCEPTION 'Sem permissão para gerenciar permissões';
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Loja não informada'; END IF;

  -- Alvo tem que ser da loja resolvida.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = _user_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Usuário não pertence à loja';
  END IF;

  -- Substitui atomicamente (delete + insert na mesma txn).
  DELETE FROM public.user_permissions WHERE user_id = _user_id;
  INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
  SELECT _user_id, v_tenant, p->>'pagina',
         COALESCE((p->>'pode_ver')::boolean, false),
         COALESCE((p->>'pode_editar')::boolean, false)
  FROM jsonb_array_elements(COALESCE(_perms, '[]'::jsonb)) p
  WHERE NULLIF(p->>'pagina','') IS NOT NULL
    AND (COALESCE((p->>'pode_ver')::boolean, false) OR COALESCE((p->>'pode_editar')::boolean, false));
END;
$function$;

select pg_notify('pgrst','reload schema');
