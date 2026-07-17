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

commit;
