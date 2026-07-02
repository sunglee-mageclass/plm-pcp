-- OTB (Open To Buy): coleção vira entidade dona (nome, ano, mês, semanas, orçamento).
-- ADITIVA: modelos.colecao (texto) permanece (livre quando OTB off; espelho do nome
-- quando OTB on). Nada é dropado.

-- 1. Coleção (a entidade dona)
create table if not exists public.colecoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  nome varchar not null,
  ano_id uuid references public.anos(id),
  mes_id uuid references public.meses(id),
  orcamento numeric,
  status varchar not null default 'rascunho' check (status in ('rascunho','confirmada')),
  created_at timestamptz not null default now(),
  unique (tenant_id, nome)
);

-- 2. Semanas da coleção (qtd de modelos por semana)
create table if not exists public.colecao_semanas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  semana varchar not null,
  qtd_planejada int not null default 0,
  unique (colecao_id, semana)
);

-- 3. modelos ganha o FK da coleção (texto colecao permanece)
alter table public.modelos
  add column if not exists colecao_id uuid references public.colecoes(id);

-- Índices das FKs (embedadas sem UNIQUE → seq scan sem índice)
create index if not exists idx_colecoes_ano on public.colecoes(ano_id);
create index if not exists idx_colecoes_mes on public.colecoes(mes_id);
create index if not exists idx_colecao_semanas_colecao on public.colecao_semanas(colecao_id);
create index if not exists idx_modelos_colecao on public.modelos(colecao_id);

-- Trigger de tenant (auto-preenche tenant_id na inserção)
create or replace trigger set_tenant_id_trg before insert on public.colecoes
  for each row execute function public.set_tenant_id();
create or replace trigger set_tenant_id_trg before insert on public.colecao_semanas
  for each row execute function public.set_tenant_id();

-- Grants (o RLS faz o gate real)
grant all on public.colecoes to anon, authenticated, service_role;
grant all on public.colecao_semanas to anon, authenticated, service_role;

-- RLS por tenant (4 policies cada)
alter table public.colecoes enable row level security;
alter table public.colecao_semanas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['colecoes','colecao_semanas'] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format('create policy tenant_select on public.%I for select to authenticated using (tenant_id = public.get_user_tenant_id())', t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format('create policy tenant_insert on public.%I for insert to authenticated with check (tenant_id = public.get_user_tenant_id() or tenant_id is null)', t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format('create policy tenant_update on public.%I for update to authenticated using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id())', t);
    execute format('drop policy if exists tenant_delete on public.%I', t);
    execute format('create policy tenant_delete on public.%I for delete to authenticated using (tenant_id = public.get_user_tenant_id())', t);
  end loop;
end $$;

select pg_notify('pgrst','reload schema');
