-- 20260727100000_plan_tecido_estoque.sql — Fase B (resumo): a "conta" por variante do plano.
-- Retorna estoque físico / a receber (OC encomendada) / reservado / previsto p/ o Resumo mostrar
-- necessidade × estoque × encomendado × falta. Fonte única = _estoque_tecido_core (invariante #4).
begin;

create or replace function public._plan_tecido_estoque_core(_tenant uuid, _variante_ids uuid[])
returns table(variante_tecido_id uuid, fisico numeric, a_receber numeric, reservado numeric, previsto numeric)
language sql stable security definer set search_path to 'public' as $$
  select e.variante_tecido_id, e.fisico, e.prev_receb_m, e.reservado, e.previsto
  from public._estoque_tecido_core(_tenant) e
  where e.variante_tecido_id = any(_variante_ids)
$$;

create or replace function public.plan_tecido_estoque(_variante_ids uuid[])
returns table(variante_tecido_id uuid, fisico numeric, a_receber numeric, reservado numeric, previsto numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then return; end if;
  return query select * from public._plan_tecido_estoque_core(public.get_user_tenant_id(), coalesce(_variante_ids, '{}'::uuid[]));
end $$;

revoke execute on function public._plan_tecido_estoque_core(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.plan_tecido_estoque(uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
