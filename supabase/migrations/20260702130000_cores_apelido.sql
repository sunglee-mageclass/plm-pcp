-- Cor apelido: nome alternativo (apelido) atrelado a uma Cor base (public.cores).
-- Uma cor base pode ter vários apelidos. Aditivo; RLS por tenant espelha `cores`.

create table if not exists public.cores_apelido (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  nome varchar not null,
  cor_base_id uuid references public.cores(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_cores_apelido_base on public.cores_apelido(cor_base_id);

-- Trigger de tenant (auto-preenche tenant_id) — igual `cores`
create or replace trigger set_tenant_id_trg before insert on public.cores_apelido
  for each row execute function public.set_tenant_id();

-- Grants (RLS faz o gate real)
grant all on public.cores_apelido to anon, authenticated, service_role;

-- RLS por tenant (espelha as 4 policies de `cores`)
alter table public.cores_apelido enable row level security;

drop policy if exists tenant_select on public.cores_apelido;
create policy tenant_select on public.cores_apelido for select to authenticated
  using (tenant_id = public.get_user_tenant_id());
drop policy if exists tenant_insert on public.cores_apelido;
create policy tenant_insert on public.cores_apelido for insert to authenticated
  with check (tenant_id = public.get_user_tenant_id() or tenant_id is null);
drop policy if exists tenant_update on public.cores_apelido;
create policy tenant_update on public.cores_apelido for update to authenticated
  using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id());
drop policy if exists tenant_delete on public.cores_apelido;
create policy tenant_delete on public.cores_apelido for delete to authenticated
  using (tenant_id = public.get_user_tenant_id());
