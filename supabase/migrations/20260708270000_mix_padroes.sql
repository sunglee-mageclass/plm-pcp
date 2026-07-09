-- "Padrão do mix" — template de defaults que uma coleção por Poder de Venda herda.
-- Vários por loja. Por LINHA: % do mix, prof/cor, cores (markup vem do cadastro `linhas`,
-- nunca copiado). Por CATEGORIA+SUB: faixa de preço mín/máx.
-- Ver docs/superpowers/specs/2026-07-08-otb-poder-de-venda-design.md

create table if not exists public.mix_padroes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  nome varchar not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, nome)
);

create table if not exists public.mix_padrao_linhas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  padrao_id uuid not null references public.mix_padroes(id) on delete cascade,
  linha_id uuid references public.linhas(id),
  pct numeric not null default 0,
  prof_cor int not null default 0,
  cores int not null default 0,
  ordem int not null default 0
);

create table if not exists public.mix_padrao_categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  padrao_linha_id uuid not null references public.mix_padrao_linhas(id) on delete cascade,
  categoria_id uuid references public.categorias_produto(id),
  subcategoria1_id uuid references public.subcategorias1_produto(id),
  preco_min numeric not null default 0,
  preco_max numeric not null default 0,
  ordem int not null default 0
);

create index if not exists idx_mix_padrao_linhas_padrao on public.mix_padrao_linhas(padrao_id);
create index if not exists idx_mix_padrao_linhas_linha on public.mix_padrao_linhas(linha_id);
create index if not exists idx_mix_padrao_categorias_pl on public.mix_padrao_categorias(padrao_linha_id);
create index if not exists idx_mix_padrao_categorias_cat on public.mix_padrao_categorias(categoria_id);

-- tenant_id automático + grants + RLS por tenant (padrão do projeto).
do $$
declare t text;
begin
  foreach t in array array['mix_padroes','mix_padrao_linhas','mix_padrao_categorias'] loop
    execute format('create or replace trigger set_tenant_id_trg before insert on public.%I for each row execute function public.set_tenant_id()', t);
    execute format('grant all on public.%I to anon, authenticated, service_role', t);
    execute format('alter table public.%I enable row level security', t);
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

-- Salvar padrão inteiro atomicamente (cria/renomeia + substitui linhas e categorias).
-- SECURITY INVOKER: a RLS + o trigger set_tenant_id fazem o gate; sem bypass.
create or replace function public.salvar_mix_padrao(_id uuid, _nome text, _linhas jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_id uuid := _id;
  v_lin jsonb;
  v_cat jsonb;
  v_lin_id uuid;
  v_i int := 0;
  v_j int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if coalesce(btrim(_nome), '') = '' then raise exception 'Informe o nome do padrão.'; end if;

  if v_id is null then
    insert into public.mix_padroes (nome) values (_nome) returning id into v_id;
  else
    update public.mix_padroes set nome = _nome where id = v_id;  -- RLS restringe ao tenant
    if not found then raise exception 'Padrão não encontrado.'; end if;
    delete from public.mix_padrao_linhas where padrao_id = v_id;  -- cascata nas categorias
  end if;

  for v_lin in select value from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    insert into public.mix_padrao_linhas (padrao_id, linha_id, pct, prof_cor, cores, ordem)
    values (
      v_id,
      nullif(v_lin->>'linha_id', '')::uuid,
      coalesce((v_lin->>'pct')::numeric, 0),
      coalesce((v_lin->>'prof_cor')::int, 0),
      coalesce((v_lin->>'cores')::int, 0),
      v_i
    ) returning id into v_lin_id;
    v_i := v_i + 1;

    v_j := 0;
    for v_cat in select value from jsonb_array_elements(coalesce(v_lin->'categorias', '[]'::jsonb)) loop
      insert into public.mix_padrao_categorias (padrao_linha_id, categoria_id, subcategoria1_id, preco_min, preco_max, ordem)
      values (
        v_lin_id,
        nullif(v_cat->>'categoria_id', '')::uuid,
        nullif(v_cat->>'subcategoria1_id', '')::uuid,
        coalesce((v_cat->>'preco_min')::numeric, 0),
        coalesce((v_cat->>'preco_max')::numeric, 0),
        v_j
      );
      v_j := v_j + 1;
    end loop;
  end loop;

  return v_id;
end $$;

revoke execute on function public.salvar_mix_padrao(uuid, text, jsonb) from public, anon;
grant execute on function public.salvar_mix_padrao(uuid, text, jsonb) to authenticated;

create or replace function public.excluir_mix_padrao(_id uuid)
returns void
language sql
set search_path to 'public'
as $$
  delete from public.mix_padroes where id = _id;  -- RLS restringe ao tenant
$$;

revoke execute on function public.excluir_mix_padrao(uuid) from public, anon;
grant execute on function public.excluir_mix_padrao(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
