-- 20260721140000_otb_desconfirmar.sql
-- Desconfirmar uma coleção: volta status para 'rascunho'. Espelha otb_confirmar
-- (module-gated + tenant-scoped). Não mexe em cards (plano é alvo fixo).
CREATE OR REPLACE FUNCTION public.otb_desconfirmar(_colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='rascunho' where id=_colecao_id and tenant_id=v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;
  return jsonb_build_object('confirmada', false);
end;
$function$;
