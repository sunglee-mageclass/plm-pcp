-- Produto Acabado (Revenda) — Task 5 fix round 1: RPC de exclusão da OC (o front tinha um
-- `.delete()` cru com guarda só visual — achado IMPORTANT do review). Espelha o padrão real
-- de `excluir_oc_tecido`/`_excluir_oc_tecido_core` (lido via pg_get_functiondef antes de
-- escrever): RAISE P0001 se a OC já foi recebida (materializou cad/CQ — estornar antes) OU
-- tem parcela paga no financeiro; senão DELETE (o cascade em `parcelas.oc_p_acabado_id`,
-- criado na Task 3, limpa as parcelas não-pagas sozinho).

create or replace function public._excluir_oc_p_acabado_core(_oc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select status into v_status from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'OC não encontrada.' using errcode = 'P0002';
  end if;

  if v_status = 'recebido' then
    raise exception 'Não é possível excluir: OC já recebida (materializou CAD/CQ). Estorne o recebimento antes.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.parcelas where oc_p_acabado_id = _oc_id and status = 'pago') then
    raise exception 'Não é possível excluir: a OC tem parcela paga no financeiro.' using errcode = 'P0001';
  end if;

  -- Parcelas NÃO pagas somem via ON DELETE CASCADE (oc_p_acabado_id, Task 3); a parcela
  -- paga já foi barrada acima, então nenhum DELETE explícito é necessário aqui.
  delete from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.excluir_oc_p_acabado(_oc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._excluir_oc_p_acabado_core(_oc_id);
end;
$$;

revoke execute on function public._excluir_oc_p_acabado_core(uuid) from public, anon, authenticated;
revoke execute on function public.excluir_oc_p_acabado(uuid) from public, anon;
grant execute on function public.excluir_oc_p_acabado(uuid) to authenticated;
