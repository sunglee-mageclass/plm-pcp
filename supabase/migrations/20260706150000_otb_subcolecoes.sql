-- OTB: uma COLEÇÃO passa a ter várias SUBCOLEÇÕES, e as SEMANAS (com qtd de modelos)
-- pertencem à subcoleção. Hierarquia: coleção → subcoleções → semanas×qtd.
-- Modo simples (sem subcoleção) continua funcionando: colecao_semanas.subcolecao_id NULL.

-- Desfaz o modelo antigo (1 subcoleção por coleção) — nunca chegou a ser usado.
alter table public.colecoes drop column if exists subcolecao;

-- Subcoleções da coleção (N por coleção).
create table if not exists public.colecao_subcolecoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_colecao_subcolecoes_colecao on public.colecao_subcolecoes(colecao_id);
create unique index if not exists uq_colecao_subcolecoes_nome on public.colecao_subcolecoes(colecao_id, nome);

grant select, insert, update, delete on public.colecao_subcolecoes to anon, authenticated;

alter table public.colecao_subcolecoes enable row level security;
drop policy if exists tenant_select on public.colecao_subcolecoes;
drop policy if exists tenant_insert on public.colecao_subcolecoes;
drop policy if exists tenant_update on public.colecao_subcolecoes;
drop policy if exists tenant_delete on public.colecao_subcolecoes;
create policy tenant_select on public.colecao_subcolecoes for select using (tenant_id = public.get_user_tenant_id());
create policy tenant_insert on public.colecao_subcolecoes for insert with check ((tenant_id = public.get_user_tenant_id()) or (tenant_id is null));
create policy tenant_update on public.colecao_subcolecoes for update using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id());
create policy tenant_delete on public.colecao_subcolecoes for delete using (tenant_id = public.get_user_tenant_id());

drop trigger if exists set_tenant_id_trg on public.colecao_subcolecoes;
create trigger set_tenant_id_trg before insert on public.colecao_subcolecoes for each row execute function public.set_tenant_id();

-- Semanas passam a poder pertencer a uma subcoleção (NULL = semana no nível da coleção).
alter table public.colecao_semanas add column if not exists subcolecao_id uuid references public.colecao_subcolecoes(id) on delete cascade;
create index if not exists idx_colecao_semanas_subcolecao on public.colecao_semanas(subcolecao_id);

-- Troca a unicidade (colecao_id, semana) por (colecao_id, subcolecao_id, semana),
-- tratando NULL como igual (uma semana por par coleção/subcoleção; e uma por coleção
-- quando sem subcoleção).
alter table public.colecao_semanas drop constraint if exists colecao_semanas_colecao_id_semana_key;
create unique index if not exists uq_colecao_semanas_col_sub_semana
  on public.colecao_semanas (colecao_id, subcolecao_id, semana) nulls not distinct;

select pg_notify('pgrst', 'reload schema');
