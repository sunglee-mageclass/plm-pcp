-- Módulo opt-in no BACKEND: o gate genérico dava default-ON quando a chave falta em
-- tenant_config.modules — furando o opt-in do `otb` (que é default OFF). O front já
-- força OFF, mas um authenticated de loja sem OTB conseguia chamar as RPCs de OTB direto.
-- Correção: chave ausente => `otb` OFF; demais módulos seguem default ON (sem mudança).
-- Seguro: os tenants que usam OTB já têm modules.otb='true' explícito (verificado).
create or replace function public.tenant_module_enabled(_module text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    _module <> 'otb'
  );
$function$;
