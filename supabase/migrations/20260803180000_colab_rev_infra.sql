-- 20260803180000_colab_rev_infra.sql
-- Concorrência multi-usuário (spec 2026-08-03): rev nos agregados-raiz + bump por filhas.
-- rev é DO SERVIDOR (BEFORE UPDATE sempre incrementa; valor do cliente é ignorado).
-- O bump da filha é um UPDATE no-op na raiz → o BEFORE converte em rev+1 E emite o
-- evento UPDATE que o Realtime entrega (1 listener na raiz cobre o agregado inteiro).
alter table public.modelos    add column if not exists rev int not null default 1;
alter table public.ocs_tecido add column if not exists rev int not null default 1;
alter table public.colecoes   add column if not exists plan_rev int not null default 1;

create or replace function public.fn_colab_touch_rev() returns trigger
language plpgsql as $$ begin new.rev := old.rev + 1; return new; end $$;
create or replace function public.fn_colab_touch_plan_rev() returns trigger
language plpgsql as $$ begin new.plan_rev := old.plan_rev + 1; return new; end $$;

drop trigger if exists trg_colab_rev on public.modelos;
create trigger trg_colab_rev before update on public.modelos
  for each row execute function public.fn_colab_touch_rev();
drop trigger if exists trg_colab_rev on public.ocs_tecido;
create trigger trg_colab_rev before update on public.ocs_tecido
  for each row execute function public.fn_colab_touch_rev();
drop trigger if exists trg_colab_plan_rev on public.colecoes;
create trigger trg_colab_plan_rev before update on public.colecoes
  for each row execute function public.fn_colab_touch_plan_rev();

-- Bumps (SECURITY DEFINER: o UPDATE na raiz não pode esbarrar em RLS de fluxos DEFINER)
create or replace function public.fn_colab_bump_oc() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.oc_tecido_id, old.oc_tecido_id);
begin update public.ocs_tecido set id = id where id = v_id; return coalesce(new, old); end $$;

create or replace function public.fn_colab_bump_modelo() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.modelo_id, old.modelo_id);
begin update public.modelos set id = id where id = v_id; return coalesce(new, old); end $$;

create or replace function public.fn_colab_bump_modelo_via_tecido() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  select mt.modelo_id into v_id from public.modelo_tecidos mt
   where mt.id = coalesce(new.modelo_tecido_id, old.modelo_tecido_id);
  if v_id is not null then update public.modelos set id = id where id = v_id; end if;
  return coalesce(new, old);
end $$;

create or replace function public.fn_colab_bump_plan() returns trigger
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid := coalesce(new.colecao_id, old.colecao_id);
begin update public.colecoes set id = id where id = v_id; return coalesce(new, old); end $$;

-- OC: itens
drop trigger if exists trg_colab_bump on public.ocs_tecido_itens;
create trigger trg_colab_bump after insert or update or delete on public.ocs_tecido_itens
  for each row execute function public.fn_colab_bump_oc();

-- Modelo: filhas com modelo_id direto
do $$ declare t text;
begin
  foreach t in array array['modelo_tecidos','modelo_grades','modelo_aviamentos',
                           'modelo_etiquetas','modelo_observacoes','modelo_prova_comentarios',
                           'modelo_tecido_oc_links']
  loop
    execute format('drop trigger if exists trg_colab_bump on public.%I', t);
    execute format('create trigger trg_colab_bump after insert or update or delete on public.%I
                    for each row execute function public.fn_colab_bump_modelo()', t);
  end loop;
end $$;
-- Modelo: variantes (via modelo_tecidos)
drop trigger if exists trg_colab_bump on public.modelo_tecido_variantes;
create trigger trg_colab_bump after insert or update or delete on public.modelo_tecido_variantes
  for each row execute function public.fn_colab_bump_modelo_via_tecido();

-- Plan. Tecido: tabelas com colecao_id direto. A ÁRVORE (subcolecoes/linhas/slots/materiais)
-- tem UM único escritor (salvar_plan_tecido) — o bump dela é feito DENTRO da RPC (Task 2),
-- não por trigger multi-nível (decisão de simplificação; mesma garantia).
do $$ declare t text;
begin
  foreach t in array array['plan_tecido','plan_tecido_oc_aplicada','plan_tecido_slot_oc']
  loop
    execute format('drop trigger if exists trg_colab_bump on public.%I', t);
    execute format('create trigger trg_colab_bump after insert or update or delete on public.%I
                    for each row execute function public.fn_colab_bump_plan()', t);
  end loop;
end $$;

-- Publicação Realtime (VERIFICADO vazia hoje) — sem isto o postgres_changes não dispara.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='modelos')
    then alter publication supabase_realtime add table public.modelos; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='ocs_tecido')
    then alter publication supabase_realtime add table public.ocs_tecido; end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='colecoes')
    then alter publication supabase_realtime add table public.colecoes; end if;
end $$;
