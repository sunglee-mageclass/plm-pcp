-- 20260730100000_plan_tecido_modelo_oc.sql — Plan. Tecido #3: HINT de OC por modelo (planejamento).
-- Guarda "este modelo vai usar a(s) OC(s) X" no nível do PLANO — NÃO toca em modelo_tecido_oc_links
-- (o vínculo real que congela custo segue exclusivo do Desenvolvimento). É só orientação/planejamento.
begin;

create table if not exists public.plan_tecido_modelo_oc (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  modelo_id uuid not null references public.modelos(id) on delete cascade,
  oc_tecido_id uuid not null references public.ocs_tecido(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint uq_plan_tecido_modelo_oc unique (colecao_id, modelo_id, oc_tecido_id)
);
create index if not exists idx_plan_tecido_modelo_oc_colecao on public.plan_tecido_modelo_oc(colecao_id);
create index if not exists idx_plan_tecido_modelo_oc_modelo on public.plan_tecido_modelo_oc(modelo_id);

do $$ begin
  execute 'alter table public.plan_tecido_modelo_oc enable row level security';
  execute 'drop policy if exists tenant_select on public.plan_tecido_modelo_oc';
  execute 'create policy tenant_select on public.plan_tecido_modelo_oc for select to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'drop policy if exists tenant_insert on public.plan_tecido_modelo_oc';
  execute 'create policy tenant_insert on public.plan_tecido_modelo_oc for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)';
  execute 'drop policy if exists tenant_delete on public.plan_tecido_modelo_oc';
  execute 'create policy tenant_delete on public.plan_tecido_modelo_oc for delete to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'grant all on public.plan_tecido_modelo_oc to anon, authenticated, service_role';
  execute 'create or replace trigger set_tenant_id_trg before insert on public.plan_tecido_modelo_oc for each row execute function public.set_tenant_id()';
end $$;

-- SET: grava as OCs (hint) de um modelo (delete-all + insert atômico)
create or replace function public._plan_tecido_set_modelo_oc_core(_tenant uuid, _colecao_id uuid, _modelo_id uuid, _oc_ids uuid[])
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  if (select tenant_id from modelos where id = _modelo_id) is distinct from _tenant then
    raise exception 'Modelo de outra loja.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(_modelo_id::text || ':modelo_oc'));
  delete from plan_tecido_modelo_oc where colecao_id = _colecao_id and modelo_id = _modelo_id;
  insert into plan_tecido_modelo_oc (tenant_id, colecao_id, modelo_id, oc_tecido_id)
  select _tenant, _colecao_id, _modelo_id, oc.id
  from unnest(coalesce(_oc_ids, '{}'::uuid[])) x(oc_id)
  join ocs_tecido oc on oc.id = x.oc_id and oc.tenant_id = _tenant;  -- ignora OC de outra loja
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.plan_tecido_set_modelo_oc(_colecao_id uuid, _modelo_id uuid, _oc_ids uuid[])
returns int language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_set_modelo_oc_core(public.get_user_tenant_id(), _colecao_id, _modelo_id, _oc_ids);
end $$;

revoke execute on function public._plan_tecido_set_modelo_oc_core(uuid,uuid,uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.plan_tecido_set_modelo_oc(uuid,uuid,uuid[]) to authenticated;

notify pgrst, 'reload schema';
commit;
