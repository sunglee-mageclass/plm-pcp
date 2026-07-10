-- Coleção por PODER DE VENDA (Fase 2b) — persistência.
-- colecoes ganha o tipo e os campos do fluxo PV; itens da árvore Subcoleção ▸ Linha ▸
-- Categoria+Sub ficam em colecao_pv_itens (qtd por semana em jsonb). Subcoleções reusam
-- colecao_subcolecoes. Ver docs/superpowers/specs/2026-07-08-otb-poder-de-venda-design.md

alter table public.colecoes
  add column if not exists tipo text not null default 'orcamento',
  add column if not exists poder_venda_meta numeric,
  add column if not exists perda_markup numeric not null default 25,
  add column if not exists mix_padrao_id uuid references public.mix_padroes(id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'colecoes_tipo_chk') then
    alter table public.colecoes add constraint colecoes_tipo_chk check (tipo in ('orcamento','poder_venda'));
  end if;
end $$;

-- Um item = (subcoleção, linha, categoria+sub) com a faixa de preço e a qtd por semana.
-- prof_cor/cores ficam no item (herdados do padrão, ajustáveis por coleção). Total = Σ das
-- semanas em qtd_semanas ({"1":n,"2":n,...}).
create table if not exists public.colecao_pv_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  subcolecao_id uuid not null references public.colecao_subcolecoes(id) on delete cascade,
  linha_id uuid references public.linhas(id),
  prof_cor int not null default 0,
  cores int not null default 0,
  categoria_id uuid references public.categorias_produto(id),
  subcategoria1_id uuid references public.subcategorias1_produto(id),
  preco_min numeric not null default 0,
  preco_max numeric not null default 0,
  qtd_semanas jsonb not null default '{}'::jsonb,
  ordem int not null default 0
);

create index if not exists idx_colecao_pv_itens_colecao on public.colecao_pv_itens(colecao_id);
create index if not exists idx_colecao_pv_itens_subcol on public.colecao_pv_itens(subcolecao_id);
create index if not exists idx_colecoes_mix_padrao on public.colecoes(mix_padrao_id);

create or replace trigger set_tenant_id_trg before insert on public.colecao_pv_itens
  for each row execute function public.set_tenant_id();
grant all on public.colecao_pv_itens to anon, authenticated, service_role;
alter table public.colecao_pv_itens enable row level security;
do $$ begin
  execute 'drop policy if exists tenant_select on public.colecao_pv_itens';
  execute 'create policy tenant_select on public.colecao_pv_itens for select to authenticated using (tenant_id = public.get_user_tenant_id())';
  execute 'drop policy if exists tenant_insert on public.colecao_pv_itens';
  execute 'create policy tenant_insert on public.colecao_pv_itens for insert to authenticated with check (tenant_id = public.get_user_tenant_id() or tenant_id is null)';
  execute 'drop policy if exists tenant_update on public.colecao_pv_itens';
  execute 'create policy tenant_update on public.colecao_pv_itens for update to authenticated using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id())';
  execute 'drop policy if exists tenant_delete on public.colecao_pv_itens';
  execute 'create policy tenant_delete on public.colecao_pv_itens for delete to authenticated using (tenant_id = public.get_user_tenant_id())';
end $$;

-- Salva a coleção PV inteira atomicamente: cabeçalho + subcoleções + itens.
-- SECURITY INVOKER: RLS + set_tenant_id fazem o gate. _subcolecoes aninha os itens, então
-- não há mapeamento de ids temporários — cada subcoleção é criada e seus itens penduram nela.
create or replace function public.salvar_colecao_pv(_id uuid, _header jsonb, _subcolecoes jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_id uuid := _id;
  v_sub jsonb;
  v_item jsonb;
  v_sub_id uuid;
  v_si int := 0;
  v_ii int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if coalesce(btrim(_header->>'nome'), '') = '' then raise exception 'Informe o nome da coleção.'; end if;

  if v_id is null then
    insert into public.colecoes (nome, tipo, mes_id, ano_id, mix_padrao_id, poder_venda_meta, perda_markup, status)
    values (
      _header->>'nome', 'poder_venda',
      nullif(_header->>'mes_id','')::uuid, nullif(_header->>'ano_id','')::uuid,
      nullif(_header->>'mix_padrao_id','')::uuid,
      nullif(_header->>'poder_venda_meta','')::numeric,
      coalesce((_header->>'perda_markup')::numeric, 25),
      'rascunho'
    ) returning id into v_id;
  else
    update public.colecoes set
      nome = _header->>'nome',
      mes_id = nullif(_header->>'mes_id','')::uuid,
      ano_id = nullif(_header->>'ano_id','')::uuid,
      mix_padrao_id = nullif(_header->>'mix_padrao_id','')::uuid,
      poder_venda_meta = nullif(_header->>'poder_venda_meta','')::numeric,
      perda_markup = coalesce((_header->>'perda_markup')::numeric, 25)
    where id = v_id and tipo = 'poder_venda';
    if not found then raise exception 'Coleção não encontrada.'; end if;
    delete from public.colecao_pv_itens where colecao_id = v_id;
    delete from public.colecao_subcolecoes where colecao_id = v_id;
  end if;

  for v_sub in select value from jsonb_array_elements(coalesce(_subcolecoes, '[]'::jsonb)) loop
    insert into public.colecao_subcolecoes (colecao_id, nome, ordem)
    values (v_id, coalesce(nullif(btrim(v_sub->>'nome'),''), 'Subcoleção'), v_si)
    returning id into v_sub_id;
    v_si := v_si + 1;

    v_ii := 0;
    for v_item in select value from jsonb_array_elements(coalesce(v_sub->'itens', '[]'::jsonb)) loop
      insert into public.colecao_pv_itens (colecao_id, subcolecao_id, linha_id, prof_cor, cores,
        categoria_id, subcategoria1_id, preco_min, preco_max, qtd_semanas, ordem)
      values (
        v_id, v_sub_id,
        nullif(v_item->>'linha_id','')::uuid,
        coalesce((v_item->>'prof_cor')::int, 0),
        coalesce((v_item->>'cores')::int, 0),
        nullif(v_item->>'categoria_id','')::uuid,
        nullif(v_item->>'subcategoria1_id','')::uuid,
        coalesce((v_item->>'preco_min')::numeric, 0),
        coalesce((v_item->>'preco_max')::numeric, 0),
        coalesce(v_item->'qtd_semanas', '{}'::jsonb),
        v_ii
      );
      v_ii := v_ii + 1;
    end loop;
  end loop;

  return v_id;
end $$;

revoke execute on function public.salvar_colecao_pv(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_colecao_pv(uuid, jsonb, jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
