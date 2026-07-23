-- 20260732100000_plan_tecido_vinculos.sql — Plan. Tecido (a): OCs vinculadas do Desenvolvimento.
-- Leitura das OCs reais que um modelo já usa (modelo_tecido_oc_links → itens → oc), p/ o card mostrar
-- "OC do Desenvolvimento" (read-only, congela custo) em vez de campo vazio. NÃO edita nada aqui.
begin;

create or replace function public._plan_tecido_vinculos_modelo_core(_tenant uuid, _colecao_id uuid)
returns table(modelo_id uuid, oc_tecido_id uuid, numero_pedido text, tecidos text)
language sql stable security definer set search_path to 'public' as $$
  select l.modelo_id, oc.id as oc_tecido_id,
         max(oc.numero_pedido) as numero_pedido,
         string_agg(distinct a.nome, ' · ') as tecidos
  from modelo_tecido_oc_links l
  join modelos m on m.id = l.modelo_id and m.tenant_id = _tenant and m.colecao_id = _colecao_id
  join ocs_tecido_itens it on it.id = l.oc_tecido_item_id
  join ocs_tecido oc on oc.id = it.oc_tecido_id and oc.tenant_id = _tenant
  left join artigos a on a.id = it.artigo_id
  group by l.modelo_id, oc.id
$$;

create or replace function public.plan_tecido_vinculos_modelo(_colecao_id uuid)
returns table(modelo_id uuid, oc_tecido_id uuid, numero_pedido text, tecidos text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then return; end if;
  return query select * from public._plan_tecido_vinculos_modelo_core(public.get_user_tenant_id(), _colecao_id);
end $$;

revoke execute on function public._plan_tecido_vinculos_modelo_core(uuid,uuid) from public, anon, authenticated;
grant execute on function public.plan_tecido_vinculos_modelo(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
