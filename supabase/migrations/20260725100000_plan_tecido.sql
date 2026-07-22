-- 20260725100000_plan_tecido.sql — Plan. Tecido (Fase A.1): 1 plano por coleção, tecido-cêntrico.
begin;

create table if not exists public.plan_tecido (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_plan_tecido_colecao unique (colecao_id)
);

create table if not exists public.plan_tecido_subcolecoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  plan_id uuid not null references public.plan_tecido(id) on delete cascade,
  subcolecao_id uuid references public.colecao_subcolecoes(id) on delete cascade,
  ordem int not null default 0,
  constraint uq_plan_sub unique nulls not distinct (plan_id, subcolecao_id)
);
create index if not exists idx_plan_sub_plan on public.plan_tecido_subcolecoes(plan_id);

create table if not exists public.plan_tecido_linhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  sub_id uuid not null references public.plan_tecido_subcolecoes(id) on delete cascade,
  linha_id uuid references public.linhas(id),
  categoria_id uuid references public.categorias_produto(id),
  ordem int not null default 0
);
create index if not exists idx_plan_ln_sub on public.plan_tecido_linhas(sub_id);

create table if not exists public.plan_tecido_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  linha_ref_id uuid not null references public.plan_tecido_linhas(id) on delete cascade,
  modelo_id uuid references public.modelos(id) on delete set null,
  slot_index int not null default 0,
  nome text,
  custo_simulado jsonb,
  custo_terceirizados_previsto numeric(10,2),
  custos_adicionais jsonb not null default '[]'::jsonb,
  preco_venda numeric(10,2)
);
create index if not exists idx_plan_slot_ln on public.plan_tecido_slots(linha_ref_id);
create index if not exists idx_plan_slot_modelo on public.plan_tecido_slots(modelo_id);

create table if not exists public.plan_tecido_materiais (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  slot_id uuid not null references public.plan_tecido_slots(id) on delete cascade,
  artigo_id uuid references public.artigos(id),
  tipo varchar(20) not null default 'tecido',
  numero int not null default 1,
  consumo numeric(10,4) not null default 0,
  loss_percent numeric(5,2) not null default 0,
  ordem int not null default 0,
  constraint uq_plan_mat unique (slot_id, tipo, numero)
);
create index if not exists idx_plan_mat_slot on public.plan_tecido_materiais(slot_id);
create index if not exists idx_plan_mat_artigo on public.plan_tecido_materiais(artigo_id);

create table if not exists public.plan_tecido_variantes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  material_id uuid not null references public.plan_tecido_materiais(id) on delete cascade,
  variante_tecido_id uuid references public.variantes_tecido(id),
  ordem int not null default 1,
  multiplicador numeric not null default 1,
  grades jsonb not null default '{}'::jsonb,
  grade_total int not null default 0,
  constraint uq_plan_var unique (material_id, ordem)
);
create index if not exists idx_plan_var_mat on public.plan_tecido_variantes(material_id);

-- RLS + trigger set_tenant_id (padrão de 20260722100000:46-62)
do $$
declare t text;
begin
  foreach t in array array['plan_tecido','plan_tecido_subcolecoes','plan_tecido_linhas','plan_tecido_slots','plan_tecido_materiais','plan_tecido_variantes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format($f$create policy tenant_select on public.%I for select to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = get_user_tenant_id() or tenant_id is null)$f$, t);
    execute format($f$create policy tenant_update on public.%I for update to authenticated using (tenant_id = get_user_tenant_id()) with check (tenant_id = get_user_tenant_id())$f$, t);
    execute format($f$create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = get_user_tenant_id())$f$, t);
    execute format('grant all on public.%I to anon, authenticated, service_role', t);
    execute format('create or replace trigger set_tenant_id_trg before insert on public.%I for each row execute function public.set_tenant_id()', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
