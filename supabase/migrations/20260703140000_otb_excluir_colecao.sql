-- OTB: excluir coleção. Regra: BLOQUEIA se houver modelo em status 'planejado'
-- (não pode excluir junto). Senão, exclui os modelos vinculados (em planejamento /
-- reprovado) + a coleção (colecao_semanas cai por ON DELETE CASCADE). Module-gated.
create or replace function public.otb_excluir_colecao(_colecao_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_planejados int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  perform 1 from colecoes where id = _colecao_id and tenant_id = v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;

  -- Bloqueia: modelos já 'planejado' não podem ser excluídos junto.
  select count(*) into v_planejados from modelos
    where tenant_id = v_tenant and colecao_id = _colecao_id and status_planejamento = 'planejado';
  if v_planejados > 0 then
    raise exception 'Não é possível excluir: % modelo(s) desta coleção já está(ão) em status planejado. Remova/reprove antes.', v_planejados;
  end if;

  -- Exclui os modelos vinculados (em planejamento / reprovado) e a coleção.
  delete from modelos where tenant_id = v_tenant and colecao_id = _colecao_id;
  delete from colecoes where id = _colecao_id and tenant_id = v_tenant;
end;
$function$;

revoke execute on function public.otb_excluir_colecao(uuid) from public, anon;
grant execute on function public.otb_excluir_colecao(uuid) to authenticated;
select pg_notify('pgrst','reload schema');
