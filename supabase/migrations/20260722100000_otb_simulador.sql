-- 20260722100000_otb_simulador.sql — Simulador de Uso de OC no OTB.
-- Tabelas + RPCs INVOKER (espelham salvar_colecao_pv). Idempotente/aditivo.
begin;

create table if not exists public.otb_simulacoes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  nome       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_otb_sim_colecao on public.otb_simulacoes(colecao_id);

create table if not exists public.otb_simulacao_unidades (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid,
  simulacao_id      uuid not null references public.otb_simulacoes(id) on delete cascade,
  subcolecao_id     uuid references public.colecao_subcolecoes(id) on delete cascade,
  oc_tecido_item_id uuid references public.ocs_tecido_itens(id) on delete set null,
  constraint uq_otb_sim_unidade unique nulls not distinct (simulacao_id, subcolecao_id)
);
create index if not exists idx_otb_sim_un_sim on public.otb_simulacao_unidades(simulacao_id);

create table if not exists public.otb_simulacao_linhas (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid,
  unidade_id  uuid not null references public.otb_simulacao_unidades(id) on delete cascade,
  linha_id    uuid references public.linhas(id),
  prof_cor    integer not null default 0,
  cores       integer not null default 1,
  num_modelos integer not null default 0,
  ordem       integer not null default 0
);
create index if not exists idx_otb_sim_ln_un on public.otb_simulacao_linhas(unidade_id);

create table if not exists public.otb_simulacao_modelos (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid,
  linha_ref_id uuid not null references public.otb_simulacao_linhas(id) on delete cascade,
  modelo_id    uuid references public.modelos(id) on delete set null,
  slot_index   integer not null default 0,
  consumo      numeric not null default 0
);
create index if not exists idx_otb_sim_md_ln on public.otb_simulacao_modelos(linha_ref_id);

-- RLS + policies (mesmo shape de colecao_pv_itens) + stamp de tenant, nas 4 tabelas.
do $$
declare t text;
begin
  foreach t in array array['otb_simulacoes','otb_simulacao_unidades','otb_simulacao_linhas','otb_simulacao_modelos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format($f$create policy tenant_select on public.%I for select to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)$f$, t);
    execute format($f$create policy tenant_update on public.%I for update to authenticated using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format('create or replace trigger set_tenant_id_trg before insert on public.%I for each row execute function set_tenant_id()', t);
  end loop;
end $$;

create or replace function public.salvar_simulacao(_id uuid, _header jsonb, _arvore jsonb)
returns uuid language plpgsql set search_path to 'public' as $function$
declare
  v_id uuid := _id; v_colecao uuid; v_un jsonb; v_ln jsonb; v_md jsonb;
  v_un_id uuid; v_ln_id uuid; v_li int; v_mi int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  v_colecao := nullif(_header->>'colecao_id','')::uuid;
  if v_colecao is null then raise exception 'Informe a coleção.'; end if;
  if coalesce(btrim(_header->>'nome'),'') = '' then raise exception 'Informe o nome do cenário.'; end if;
  if not exists (select 1 from public.colecoes where id = v_colecao and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Coleção não encontrada.';
  end if;

  if v_id is null then
    insert into public.otb_simulacoes (colecao_id, nome) values (v_colecao, btrim(_header->>'nome')) returning id into v_id;
  else
    update public.otb_simulacoes set nome = btrim(_header->>'nome')
      where id = v_id and colecao_id = v_colecao and tenant_id = public.get_user_tenant_id();
    if not found then raise exception 'Cenário não encontrado.'; end if;
    delete from public.otb_simulacao_unidades where simulacao_id = v_id;
  end if;

  for v_un in select value from jsonb_array_elements(coalesce(_arvore,'[]'::jsonb)) loop
    insert into public.otb_simulacao_unidades (simulacao_id, subcolecao_id, oc_tecido_item_id)
    values (v_id, nullif(v_un->>'subcolecao_id','')::uuid, nullif(v_un->>'oc_tecido_item_id','')::uuid)
    returning id into v_un_id;
    v_li := 0;
    for v_ln in select value from jsonb_array_elements(coalesce(v_un->'linhas','[]'::jsonb)) loop
      insert into public.otb_simulacao_linhas (unidade_id, linha_id, prof_cor, cores, num_modelos, ordem)
      values (v_un_id, nullif(v_ln->>'linha_id','')::uuid,
              greatest(0, coalesce((v_ln->>'prof_cor')::int, 0)),
              greatest(1, coalesce((v_ln->>'cores')::int, 1)),
              greatest(0, coalesce((v_ln->>'num_modelos')::int, 0)), v_li)
      returning id into v_ln_id;
      v_li := v_li + 1;
      v_mi := 0;
      for v_md in select value from jsonb_array_elements(coalesce(v_ln->'modelos','[]'::jsonb)) loop
        insert into public.otb_simulacao_modelos (linha_ref_id, modelo_id, slot_index, consumo)
        values (v_ln_id, nullif(v_md->>'modelo_id','')::uuid,
                coalesce((v_md->>'slot_index')::int, v_mi),
                greatest(0, coalesce((v_md->>'consumo')::numeric, 0)));
        v_mi := v_mi + 1;
      end loop;
    end loop;
  end loop;
  return v_id;
end $function$;

create or replace function public.excluir_simulacao(_id uuid)
returns void language plpgsql set search_path to 'public' as $function$
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  delete from public.otb_simulacoes where id = _id and tenant_id = public.get_user_tenant_id();
  if not found then raise exception 'Cenário não encontrado.'; end if;
end $function$;

create or replace function public.aplicar_simulacao(_simulacao_id uuid, _unidade_id uuid)
returns jsonb language plpgsql set search_path to 'public' as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_colecao uuid; v_tipo text; v_sub uuid; v_semanas int[];
  v_ln record; v_q jsonb; v_n int; v_rem int; j int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;

  select s.colecao_id into v_colecao from public.otb_simulacoes s where s.id = _simulacao_id and s.tenant_id = v_tenant;
  if v_colecao is null then raise exception 'Cenário não encontrado.'; end if;
  select tipo into v_tipo from public.colecoes where id = v_colecao and tenant_id = v_tenant;

  select subcolecao_id into v_sub from public.otb_simulacao_unidades
    where id = _unidade_id and simulacao_id = _simulacao_id and tenant_id = v_tenant;
  if not found then raise exception 'Unidade não encontrada.'; end if;

  if v_tipo = 'poder_venda' then
    select coalesce(semanas, '{}') into v_semanas from public.colecao_subcolecoes where id = v_sub and colecao_id = v_colecao;
    for v_ln in select linha_id, prof_cor, cores, num_modelos from public.otb_simulacao_linhas where unidade_id = _unidade_id and linha_id is not null loop
      v_q := '{}'::jsonb;
      v_n := coalesce(array_length(v_semanas, 1), 0);
      if v_n > 0 then
        v_rem := v_ln.num_modelos - (v_ln.num_modelos / v_n) * v_n;   -- splitEven: resto nas primeiras
        for j in 1..v_n loop
          v_q := v_q || jsonb_build_object(v_semanas[j]::text, (v_ln.num_modelos / v_n) + (case when (j-1) < v_rem then 1 else 0 end));
        end loop;
      end if;
      update public.colecao_pv_itens
        set prof_cor = greatest(0, v_ln.prof_cor),
            cores    = greatest(0, v_ln.cores),
            qtd_semanas = case when v_n > 0 then v_q else qtd_semanas end
      where colecao_id = v_colecao and subcolecao_id = v_sub and linha_id = v_ln.linha_id and tenant_id = v_tenant;
    end loop;
  else
    raise exception 'Orçamento ainda não implementado.'; -- substituído na Task 5
  end if;

  return jsonb_build_object('aplicado', true);
end $function$;

commit;
