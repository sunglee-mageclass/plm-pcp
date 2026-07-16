-- 20260721110000_otb_confirmar_enxuto.sql
-- Confirmar deixa de criar/remover cards e de sincronizar. Só marca a coleção verde.
-- (Os blanks legados já foram limpos na 20260721100000; cards manuais sobrevivem.)
CREATE OR REPLACE FUNCTION public.otb_confirmar(_colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='confirmada' where id=_colecao_id and tenant_id=v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;
  return jsonb_build_object('confirmada', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.otb_confirmar_pv(_colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  update colecoes set status='confirmada'
   where id=_colecao_id and tenant_id=v_tenant and tipo='poder_venda';
  if not found then raise exception 'Coleção (poder de venda) não encontrada'; end if;
  return jsonb_build_object('confirmada', true);
end;
$function$;
