-- 20260729100000_plan_tecido_paleta.sql — Plan. Tecido: paleta de insumos da coleção.
-- Pré-seleção (SOFT) de tecidos/forros que a coleção usa; os dropdowns dos cards oferecem a paleta
-- primeiro (mas não travam — "ver todos" + artigo já usado sempre aparece). Salva na hora.
-- + plan_tecido_cobertura_ocs: decompõe "coberto por OC" por variante×OC (p/ o Resumo dizer qual OC).
begin;

create table if not exists public.plan_tecido_paleta (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  artigo_id uuid not null references public.artigos(id) on delete cascade,
  papel text not null default 'tecido',  -- 'tecido' | 'forro'
  created_at timestamptz not null default now(),
  constraint uq_plan_tecido_paleta unique (colecao_id, artigo_id, papel)
);
create index if not exists idx_plan_tecido_paleta_colecao on public.plan_tecido_paleta(colecao_id);

do $$ begin
  execute 'alter table public.plan_tecido_paleta enable row level security';
  execute 'drop policy if exists tenant_select on public.plan_tecido_paleta';
  execute 'create policy tenant_select on public.plan_tecido_paleta for select to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'drop policy if exists tenant_insert on public.plan_tecido_paleta';
  execute 'create policy tenant_insert on public.plan_tecido_paleta for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)';
  execute 'drop policy if exists tenant_delete on public.plan_tecido_paleta';
  execute 'create policy tenant_delete on public.plan_tecido_paleta for delete to authenticated using (tenant_id = get_user_tenant_id())';
  execute 'grant all on public.plan_tecido_paleta to anon, authenticated, service_role';
  execute 'create or replace trigger set_tenant_id_trg before insert on public.plan_tecido_paleta for each row execute function public.set_tenant_id()';
end $$;

-- SET paleta (delete-all + insert atômico). _itens = [{artigo_id, papel}]
create or replace function public._plan_tecido_set_paleta_core(_tenant uuid, _colecao_id uuid, _itens jsonb)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(_colecao_id::text || ':paleta'));
  delete from plan_tecido_paleta where colecao_id = _colecao_id;
  insert into plan_tecido_paleta (tenant_id, colecao_id, artigo_id, papel)
  select _tenant, _colecao_id, (i->>'artigo_id')::uuid, coalesce(nullif(i->>'papel',''), 'tecido')
  from jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) i
  join artigos a on a.id = (i->>'artigo_id')::uuid and a.tenant_id = _tenant  -- só artigos da loja
  where nullif(i->>'artigo_id','') is not null
  on conflict (colecao_id, artigo_id, papel) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.plan_tecido_set_paleta(_colecao_id uuid, _itens jsonb)
returns int language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_set_paleta_core(public.get_user_tenant_id(), _colecao_id, _itens);
end $$;

-- COBERTURA por OC (detalhe): metros das OCs aplicadas por variante × OC (p/ o Resumo dizer qual OC)
create or replace function public._plan_tecido_cobertura_ocs_core(_tenant uuid, _colecao_id uuid)
returns table(variante_tecido_id uuid, oc_tecido_id uuid, numero_pedido text, coberto_m numeric)
language sql stable security definer set search_path to 'public' as $$
  select it.variante_tecido_id, oc.id, oc.numero_pedido,
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
  group by it.variante_tecido_id, oc.id, oc.numero_pedido
$$;

create or replace function public.plan_tecido_cobertura_ocs(_colecao_id uuid)
returns table(variante_tecido_id uuid, oc_tecido_id uuid, numero_pedido text, coberto_m numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then return; end if;
  return query select * from public._plan_tecido_cobertura_ocs_core(public.get_user_tenant_id(), _colecao_id);
end $$;

revoke execute on function public._plan_tecido_set_paleta_core(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public._plan_tecido_cobertura_ocs_core(uuid,uuid) from public, anon, authenticated;
grant execute on function public.plan_tecido_set_paleta(uuid,jsonb) to authenticated;
grant execute on function public.plan_tecido_cobertura_ocs(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
