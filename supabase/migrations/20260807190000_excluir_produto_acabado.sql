-- Produto Acabado (Revenda) — Task 6 fix round 1: RPC de exclusão do PRODUTO (o front tinha
-- um `.delete()` cru com guarda só visual — achado Important do review). Espelha o padrão real
-- de `excluir_oc_p_acabado`/`_excluir_oc_p_acabado_core` (lido via pg_get_functiondef antes de
-- escrever): RAISE P0001 se existir OC vinculada (qualquer status — desvincule antes); o modelo
-- espelho (`produtos_acabados.modelo_id`) NÃO bloqueia a exclusão — vira um modelo comum,
-- independente, no Planejamento (decisão de produto; o front avisa disso ANTES de confirmar,
-- ver ProdutoCard.tsx). `produto_acabado_variantes` cai sozinho via ON DELETE CASCADE
-- (`produto_acabado_id`, Task 1) — sem DELETE explícito necessário.

create or replace function public._excluir_produto_acabado_core(_produto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_oc_id uuid;
  v_oc_numero text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  perform 1 from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Produto não encontrado.' using errcode = 'P0002';
  end if;

  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado
    where produto_acabado_id = _produto_id and tenant_id = v_tenant
    limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de excluir.', coalesce(v_oc_numero, 'sem número')
      using errcode = 'P0001';
  end if;

  delete from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
end;
$$;

create or replace function public.excluir_produto_acabado(_produto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._excluir_produto_acabado_core(_produto_id);
end;
$$;

revoke execute on function public._excluir_produto_acabado_core(uuid) from public, anon, authenticated;
revoke execute on function public.excluir_produto_acabado(uuid) from public, anon;
grant execute on function public.excluir_produto_acabado(uuid) to authenticated;
