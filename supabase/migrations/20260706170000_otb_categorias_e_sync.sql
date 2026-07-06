-- OTB parte 2: (a) distribuição de CATEGORIAS por semana e (b) integração de volta
-- Planejamento→OTB (apagar card baixa a qtd da semana/subcoleção/categoria).

-- (a) Distribuição por categoria de uma semana (de uma subcoleção ou da coleção).
-- Chave por (colecao_id, subcolecao_id, semana, categoria_id) — independente do id da
-- linha de colecao_semanas (que é regravada a cada save). qtd por categoria; a soma
-- fecha com a qtd da semana (validado na UI).
create table if not exists public.colecao_semana_categorias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  colecao_id uuid not null references public.colecoes(id) on delete cascade,
  subcolecao_id uuid references public.colecao_subcolecoes(id) on delete cascade,
  semana text not null,
  categoria_id uuid not null references public.categorias_produto(id) on delete cascade,
  qtd int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_csc_colecao on public.colecao_semana_categorias(colecao_id);
create unique index if not exists uq_csc_col_sub_sem_cat
  on public.colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id) nulls not distinct;

grant select, insert, update, delete on public.colecao_semana_categorias to anon, authenticated;

alter table public.colecao_semana_categorias enable row level security;
drop policy if exists tenant_select on public.colecao_semana_categorias;
drop policy if exists tenant_insert on public.colecao_semana_categorias;
drop policy if exists tenant_update on public.colecao_semana_categorias;
drop policy if exists tenant_delete on public.colecao_semana_categorias;
create policy tenant_select on public.colecao_semana_categorias for select using (tenant_id = public.get_user_tenant_id());
create policy tenant_insert on public.colecao_semana_categorias for insert with check ((tenant_id = public.get_user_tenant_id()) or (tenant_id is null));
create policy tenant_update on public.colecao_semana_categorias for update using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id());
create policy tenant_delete on public.colecao_semana_categorias for delete using (tenant_id = public.get_user_tenant_id());

drop trigger if exists set_tenant_id_trg on public.colecao_semana_categorias;
create trigger set_tenant_id_trg before insert on public.colecao_semana_categorias for each row execute function public.set_tenant_id();

-- (b) Apagar um card ligado ao OTB baixa a qtd planejada da sua (semana, subcoleção) e,
-- se houver, da sua categoria. Não roda durante a reconciliação do otb_confirmar (guard
-- GUC app.otb_reconciling), senão o encolher da RPC baixaria duas vezes.
create or replace function public.fn_otb_dec_semana_on_delete()
returns trigger language plpgsql as $$
declare v_sub_id uuid;
begin
  if OLD.colecao_id is not null
     and coalesce(current_setting('app.otb_reconciling', true), '') <> 'on' then
    if coalesce(OLD.subcolecao, '') <> '' then
      select id into v_sub_id from public.colecao_subcolecoes
        where colecao_id = OLD.colecao_id and nome = OLD.subcolecao limit 1;
    else
      v_sub_id := null;
    end if;
    update public.colecao_semanas
      set qtd_planejada = greatest(0, qtd_planejada - 1)
      where colecao_id = OLD.colecao_id
        and coalesce(semana, '') = coalesce(OLD.semana, '')
        and coalesce(subcolecao_id::text, '') = coalesce(v_sub_id::text, '');
    if OLD.categoria_principal_id is not null then
      update public.colecao_semana_categorias
        set qtd = greatest(0, qtd - 1)
        where colecao_id = OLD.colecao_id
          and semana = coalesce(OLD.semana, '')
          and coalesce(subcolecao_id::text, '') = coalesce(v_sub_id::text, '')
          and categoria_id = OLD.categoria_principal_id;
    end if;
  end if;
  return OLD;
end $$;

drop trigger if exists trg_otb_dec_semana on public.modelos;
create trigger trg_otb_dec_semana after delete on public.modelos
  for each row execute function public.fn_otb_dec_semana_on_delete();

select pg_notify('pgrst', 'reload schema');
