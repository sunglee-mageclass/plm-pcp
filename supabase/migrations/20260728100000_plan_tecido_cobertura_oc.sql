-- 20260728100000_plan_tecido_cobertura_oc.sql — Fase C: "aplicar OC" (atribuição).
-- O usuário escolhe OCs reais; o Resumo mostra "coberto por estas OCs" por variante.
-- ATENÇÃO: cobertura é INFORMATIVA — NÃO entra no cálculo de "falta" (a OC escolhida já está
-- no previsto do _estoque_tecido_core: encomendado→a_receber, recebido→físico). Somar de novo
-- contaria em dobro. "falta" segue = necessidade − previsto (via plan_tecido_estoque).
begin;

-- seleção persistente de OCs "aplicadas" a uma coleção (por atribuição)
create table if not exists public.plan_tecido_oc_aplicada (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  oc_tecido_id uuid not null references public.ocs_tecido(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint uq_plan_tecido_oc_aplicada unique (colecao_id, oc_tecido_id)
);
create index if not exists idx_plan_tecido_oc_aplicada_colecao on public.plan_tecido_oc_aplicada(colecao_id);

do $$ begin
  execute 'alter table public.plan_tecido_oc_aplicada enable row level security';
  execute 'drop policy if exists tenant_select on public.plan_tecido_oc_aplicada';
  execute 'create policy tenant_select on public.plan_tecido_oc_aplicada for select to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'drop policy if exists tenant_insert on public.plan_tecido_oc_aplicada';
  execute 'create policy tenant_insert on public.plan_tecido_oc_aplicada for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)';
  execute 'drop policy if exists tenant_delete on public.plan_tecido_oc_aplicada';
  execute 'create policy tenant_delete on public.plan_tecido_oc_aplicada for delete to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'grant all on public.plan_tecido_oc_aplicada to anon, authenticated, service_role';
  execute 'create or replace trigger set_tenant_id_trg before insert on public.plan_tecido_oc_aplicada for each row execute function public.set_tenant_id()';
end $$;

-- SET: grava o conjunto de OCs aplicadas (delete-all + insert atômico)
create or replace function public._plan_tecido_set_oc_aplicada_core(_tenant uuid, _colecao_id uuid, _oc_ids uuid[])
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(_colecao_id::text || ':oc_aplicada'));
  delete from plan_tecido_oc_aplicada where colecao_id = _colecao_id;
  insert into plan_tecido_oc_aplicada (tenant_id, colecao_id, oc_tecido_id)
  select _tenant, _colecao_id, oc.id
  from unnest(coalesce(_oc_ids, '{}'::uuid[])) x(oc_id)
  join ocs_tecido oc on oc.id = x.oc_id and oc.tenant_id = _tenant;  -- ignora OC de outra loja
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.plan_tecido_set_oc_aplicada(_colecao_id uuid, _oc_ids uuid[])
returns int language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_set_oc_aplicada_core(public.get_user_tenant_id(), _colecao_id, _oc_ids);
end $$;

-- COBERTURA: metros das OCs aplicadas por variante (kg→×rendimento). Informativo (ver topo).
create or replace function public._plan_tecido_cobertura_core(_tenant uuid, _colecao_id uuid)
returns table(variante_tecido_id uuid, coberto_m numeric)
language sql stable security definer set search_path to 'public' as $$
  select it.variante_tecido_id,
         sum(case when a.unidade_medida = 'kg'
                  then coalesce(it.quantidade_pedida,0) * coalesce(a.rendimento,0)
                  else coalesce(it.quantidade_pedida,0) end) as coberto_m
  from plan_tecido_oc_aplicada pa
  join ocs_tecido oc on oc.id = pa.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
  join ocs_tecido_itens it on it.oc_tecido_id = oc.id
  join artigos a on a.id = it.artigo_id
  where pa.colecao_id = _colecao_id
    and coalesce(it.cancelado,false) = false
    and it.variante_tecido_id is not null
  group by it.variante_tecido_id
$$;

create or replace function public.plan_tecido_cobertura(_colecao_id uuid)
returns table(variante_tecido_id uuid, coberto_m numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then return; end if;
  return query select * from public._plan_tecido_cobertura_core(public.get_user_tenant_id(), _colecao_id);
end $$;

revoke execute on function public._plan_tecido_set_oc_aplicada_core(uuid,uuid,uuid[]) from public, anon, authenticated;
revoke execute on function public._plan_tecido_cobertura_core(uuid,uuid) from public, anon, authenticated;
grant execute on function public.plan_tecido_set_oc_aplicada(uuid,uuid[]) to authenticated;
grant execute on function public.plan_tecido_cobertura(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
