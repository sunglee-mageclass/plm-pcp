-- Categoria de Produto em 4 níveis: Grupo > Categoria > (Subcategoria 1 | Subcategoria 2)
-- Sub1 e Sub2 são IRMÃS (ambas penduram na Categoria). SLA de oficina passa p/ a Sub1.
--
-- MIGRAÇÃO ADITIVA de propósito: NÃO dropa `modelos.categoria_secundaria_id` nem
-- `categorias_produto.sla_oficina` (viram colunas mortas). Migrations aplicam no banco
-- na hora, mas o front deploya manualmente depois — dropar quebraria o front já no ar
-- (embeds `cat_s:categoria_secundaria_id(nome)`) durante a janela de deploy.
-- `modelos.categoria_principal_id` continua sendo A Categoria (nível 2).

-- 1. Grupo (topo)
create table if not exists public.grupos_produto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  nome varchar not null,
  created_at timestamptz not null default now()
);

-- 2. Categoria ganha o pai (Grupo)
alter table public.categorias_produto
  add column if not exists grupo_id uuid references public.grupos_produto(id);

-- 3. Subcategoria 1 (filha da Categoria) — guarda o SLA de oficina
create table if not exists public.subcategorias1_produto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  nome varchar not null,
  categoria_id uuid references public.categorias_produto(id),
  sla_oficina numeric,
  created_at timestamptz not null default now()
);

-- 4. Subcategoria 2 (filha da Categoria)
create table if not exists public.subcategorias2_produto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  nome varchar not null,
  categoria_id uuid references public.categorias_produto(id),
  created_at timestamptz not null default now()
);

-- 5. modelos: as duas subcategorias (opcionais, definidas no Desenvolvimento)
alter table public.modelos
  add column if not exists subcategoria1_id uuid references public.subcategorias1_produto(id),
  add column if not exists subcategoria2_id uuid references public.subcategorias2_produto(id);

-- Índices das FKs
create index if not exists idx_categorias_produto_grupo on public.categorias_produto(grupo_id);
create index if not exists idx_sub1_produto_categoria on public.subcategorias1_produto(categoria_id);
create index if not exists idx_sub2_produto_categoria on public.subcategorias2_produto(categoria_id);
create index if not exists idx_modelos_sub1 on public.modelos(subcategoria1_id);
create index if not exists idx_modelos_sub2 on public.modelos(subcategoria2_id);

-- Trigger de tenant (auto-preenche tenant_id na inserção) — igual categorias_produto
create or replace trigger set_tenant_id_trg before insert on public.grupos_produto
  for each row execute function public.set_tenant_id();
create or replace trigger set_tenant_id_trg before insert on public.subcategorias1_produto
  for each row execute function public.set_tenant_id();
create or replace trigger set_tenant_id_trg before insert on public.subcategorias2_produto
  for each row execute function public.set_tenant_id();

-- Grants (espelham categorias_produto; o RLS faz o gate real)
grant all on public.grupos_produto to anon, authenticated, service_role;
grant all on public.subcategorias1_produto to anon, authenticated, service_role;
grant all on public.subcategorias2_produto to anon, authenticated, service_role;

-- RLS por tenant (espelha as 4 policies de categorias_produto)
alter table public.grupos_produto enable row level security;
alter table public.subcategorias1_produto enable row level security;
alter table public.subcategorias2_produto enable row level security;

do $$
declare t text;
begin
  foreach t in array array['grupos_produto','subcategorias1_produto','subcategorias2_produto'] loop
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
