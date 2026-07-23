-- 20260735100100_plan_tecido_cobertura_status.sql — cobertura auto-inclui OCs do próprio plano + status.
-- A "coberto por OC" do Resumo passa a considerar plan_tecido_oc_aplicada (aplicadas manualmente) UNIÃO
-- plan_tecido_ocs (geradas pelo Fazer pedido) — então a OC criada JÁ aparece no Resumo, sem aplicar à mão.
-- E devolve o status da OC (encomendado × recebido) p/ o ícone no Resumo.
begin;

-- agregado por variante (informativo)
create or replace function public._plan_tecido_cobertura_core(_tenant uuid, _colecao_id uuid)
returns table(variante_tecido_id uuid, coberto_m numeric)
language sql stable security definer set search_path to 'public' as $$
  select it.variante_tecido_id,
         sum(case when a.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0)*coalesce(a.rendimento,0)
                  else coalesce(it.quantidade_pedida,0) end) as coberto_m
  from (select oc_tecido_id from plan_tecido_oc_aplicada where colecao_id = _colecao_id
        union select oc_tecido_id from plan_tecido_ocs where colecao_id = _colecao_id) src
  join ocs_tecido oc on oc.id = src.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
  join ocs_tecido_itens it on it.oc_tecido_id = oc.id
  join artigos a on a.id = it.artigo_id
  where coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
  group by it.variante_tecido_id
$$;

-- detalhe por variante × OC + STATUS (muda a assinatura → DROP+CREATE)
drop function if exists public.plan_tecido_cobertura_ocs(uuid);
drop function if exists public._plan_tecido_cobertura_ocs_core(uuid,uuid);

create function public._plan_tecido_cobertura_ocs_core(_tenant uuid, _colecao_id uuid)
returns table(variante_tecido_id uuid, oc_tecido_id uuid, numero_pedido text, status text, coberto_m numeric)
language sql stable security definer set search_path to 'public' as $$
  select it.variante_tecido_id, oc.id, oc.numero_pedido, oc.status,
         sum(case when a.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0)*coalesce(a.rendimento,0)
                  else coalesce(it.quantidade_pedida,0) end) as coberto_m
  from (select oc_tecido_id from plan_tecido_oc_aplicada where colecao_id = _colecao_id
        union select oc_tecido_id from plan_tecido_ocs where colecao_id = _colecao_id) src
  join ocs_tecido oc on oc.id = src.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
  join ocs_tecido_itens it on it.oc_tecido_id = oc.id
  join artigos a on a.id = it.artigo_id
  where coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
  group by it.variante_tecido_id, oc.id, oc.numero_pedido, oc.status
$$;

create function public.plan_tecido_cobertura_ocs(_colecao_id uuid)
returns table(variante_tecido_id uuid, oc_tecido_id uuid, numero_pedido text, status text, coberto_m numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then return; end if;
  return query select * from public._plan_tecido_cobertura_ocs_core(public.get_user_tenant_id(), _colecao_id);
end $$;

revoke execute on function public._plan_tecido_cobertura_ocs_core(uuid,uuid) from public, anon, authenticated;
grant execute on function public.plan_tecido_cobertura_ocs(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
