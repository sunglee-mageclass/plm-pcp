-- Volta da D6: reemite tenant_module_enabled / _tenant_modulo_ligado SEM 'armario' na lista opt-in.
-- ⚠️ Antes de rodar, tire 'armario' das 4 listas do FRONT (useTenantModules.DEFAULTS, admin/lojas.tsx MODULE_DEFAULTS)
--    e do catalogo (gate da pagina criacao_armario), senao o anti-drift quebra. Idempotente.
SET client_encoding = 'UTF8';
BEGIN;

CREATE OR REPLACE FUNCTION public.tenant_module_enabled(_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    _module NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao', 'etapas_pl')
  );
$function$;

CREATE OR REPLACE FUNCTION public._tenant_modulo_ligado(_tenant uuid, _modulo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT (c.modules ->> _modulo) = 'true' FROM public.tenant_config c WHERE c.tenant_id = _tenant),
    _modulo NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao', 'etapas_pl')
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_module_enabled(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._tenant_modulo_ligado(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
