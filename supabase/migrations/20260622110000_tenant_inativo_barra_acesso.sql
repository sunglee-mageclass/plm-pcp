-- Item 9 (Fase 1): tenants.ativo passa a ser SUSPENSÃO REAL (não só rótulo).
-- get_user_tenant_id() retorna um UUID SENTINELA impossível (nil uuid) para
-- usuário de loja INATIVA (super_admin isento, para poder reativar). Efeito:
--   • RLS `tenant_id = get_user_tenant_id()` → `= nil` não casa nada → bloqueia
--     leituras E escritas (WITH CHECK) das tabelas.
--   • RPCs SECURITY DEFINER que checam `v_tenant <> get_user_tenant_id() AND NOT
--     is_super_admin()` → `v_tenant <> nil` = TRUE → RAISE 'Sem permissão'
--     (com NULL isso viraria UNKNOWN e a RPC PROSSEGUIRIA — o furo que a
--     sentinela fecha).
-- Verificado antes: nenhuma função/policy usa `get_user_tenant_id() IS NULL`, e
-- nenhum tenant tem o nil uuid. is_super_admin() só lê user_roles (sem recursão).
-- meu_tenant_ativo() é lido pelo front para mostrar a mensagem "Loja inativa".

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT u.tenant_id
       FROM public.users u
       JOIN public.tenants t ON t.id = u.tenant_id
      WHERE u.id = auth.uid()
        AND (COALESCE(t.ativo, true) OR public.is_super_admin())),
    '00000000-0000-0000-0000-000000000000'::uuid
  )
$function$;

-- Para o front: a loja do usuário atual está ativa? (super_admin sempre true;
-- lê tenants.ativo direto, então funciona mesmo com o usuário já bloqueado.)
CREATE OR REPLACE FUNCTION public.meu_tenant_ativo()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin()
    OR COALESCE(
      (SELECT t.ativo FROM public.users u JOIN public.tenants t ON t.id = u.tenant_id WHERE u.id = auth.uid()),
      true
    );
$function$;
