-- [#4/#7] Defense-in-depth: as tabelas-filhas do OTB PV têm FKs para tabelas com tenant
-- (linhas, categorias_produto, subcategorias1_produto, mix_padroes, colecoes). O WITH CHECK
-- da RLS só valida o tenant da PRÓPRIA linha, não o do registro referenciado — então dava
-- pra pendurar um FK de OUTRO tenant (via payload forjado da RPC ou insert direto). Espelha
-- o padrão enforce_empresa_tenant: valida que cada FK aponta pra linha do MESMO tenant.
-- Usa coalesce(NEW.tenant_id, get_user_tenant_id()) p/ não depender da ordem dos triggers
-- BEFORE (o set_tenant_id carimba o tenant; aqui só conferimos). SELECTs sob RLS: um id de
-- outro tenant fica invisível => NULL => bloqueia (igual a "não existe").

create or replace function public.enforce_pv_itens_tenant()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_t uuid; v_esperado uuid := coalesce(NEW.tenant_id, public.get_user_tenant_id());
begin
  if NEW.linha_id is not null then
    select tenant_id into v_t from linhas where id = NEW.linha_id;
    if v_t is distinct from v_esperado then raise exception 'Linha de outra loja' using errcode='42501'; end if;
  end if;
  if NEW.categoria_id is not null then
    select tenant_id into v_t from categorias_produto where id = NEW.categoria_id;
    if v_t is distinct from v_esperado then raise exception 'Categoria de outra loja' using errcode='42501'; end if;
  end if;
  if NEW.subcategoria1_id is not null then
    select tenant_id into v_t from subcategorias1_produto where id = NEW.subcategoria1_id;
    if v_t is distinct from v_esperado then raise exception 'Subcategoria de outra loja' using errcode='42501'; end if;
  end if;
  if NEW.colecao_id is not null then
    select tenant_id into v_t from colecoes where id = NEW.colecao_id;
    if v_t is distinct from v_esperado then raise exception 'Coleção de outra loja' using errcode='42501'; end if;
  end if;
  return NEW;
end $$;

create or replace function public.enforce_mix_linha_tenant()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_t uuid; v_esperado uuid := coalesce(NEW.tenant_id, public.get_user_tenant_id());
begin
  if NEW.padrao_id is not null then
    select tenant_id into v_t from mix_padroes where id = NEW.padrao_id;
    if v_t is distinct from v_esperado then raise exception 'Padrão de outra loja' using errcode='42501'; end if;
  end if;
  if NEW.linha_id is not null then
    select tenant_id into v_t from linhas where id = NEW.linha_id;
    if v_t is distinct from v_esperado then raise exception 'Linha de outra loja' using errcode='42501'; end if;
  end if;
  return NEW;
end $$;

create or replace function public.enforce_mix_cat_tenant()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_t uuid; v_esperado uuid := coalesce(NEW.tenant_id, public.get_user_tenant_id());
begin
  if NEW.padrao_linha_id is not null then
    select tenant_id into v_t from mix_padrao_linhas where id = NEW.padrao_linha_id;
    if v_t is distinct from v_esperado then raise exception 'Linha de padrão de outra loja' using errcode='42501'; end if;
  end if;
  if NEW.categoria_id is not null then
    select tenant_id into v_t from categorias_produto where id = NEW.categoria_id;
    if v_t is distinct from v_esperado then raise exception 'Categoria de outra loja' using errcode='42501'; end if;
  end if;
  if NEW.subcategoria1_id is not null then
    select tenant_id into v_t from subcategorias1_produto where id = NEW.subcategoria1_id;
    if v_t is distinct from v_esperado then raise exception 'Subcategoria de outra loja' using errcode='42501'; end if;
  end if;
  return NEW;
end $$;

drop trigger if exists z_enforce_tenant_trg on public.colecao_pv_itens;
create trigger z_enforce_tenant_trg before insert or update on public.colecao_pv_itens
  for each row execute function public.enforce_pv_itens_tenant();
drop trigger if exists z_enforce_tenant_trg on public.mix_padrao_linhas;
create trigger z_enforce_tenant_trg before insert or update on public.mix_padrao_linhas
  for each row execute function public.enforce_mix_linha_tenant();
drop trigger if exists z_enforce_tenant_trg on public.mix_padrao_categorias;
create trigger z_enforce_tenant_trg before insert or update on public.mix_padrao_categorias
  for each row execute function public.enforce_mix_cat_tenant();
