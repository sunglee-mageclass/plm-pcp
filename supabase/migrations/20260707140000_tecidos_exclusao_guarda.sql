-- Robustez da tela Tecidos: exclusão com GUARDA de uso (em vez de apagar em silêncio), índice
-- único p/ variante (artigo,cor,apelido), junção de categorias atômica, e o mais importante:
-- estoque_tecido_baixas deixa de ser ON DELETE CASCADE — era um buraco: apagar uma cor/tecido
-- apagava o LEDGER de estoque sem aviso. Agora o ledger BLOQUEIA a exclusão no próprio banco
-- (defesa em profundidade: mesmo um caminho fora das RPCs não apaga baixa).

-- 1) Blindagem do ledger de estoque: CASCADE -> NO ACTION.
alter table public.estoque_tecido_baixas drop constraint if exists estoque_tecido_baixas_variante_tecido_id_fkey;
alter table public.estoque_tecido_baixas
  add constraint estoque_tecido_baixas_variante_tecido_id_fkey
  foreign key (variante_tecido_id) references public.variantes_tecido(id);

-- 2) Índice único: impede variante duplicada (mesma cor + apelido no mesmo tecido). Parcial (só
--    quando ambos não-nulos) p/ não brigar com variantes antigas sem apelido.
create unique index if not exists uq_variantes_tecido_artigo_cor_apelido
  on public.variantes_tecido (artigo_id, cor_id, cor_apelido_id)
  where cor_id is not null and cor_apelido_id is not null;

-- 3) Junção de categorias do tecido, ATÔMICA (substitui o delete-all + insert do cliente, que
--    podia deixar o tecido sem nenhuma categoria se o insert falhasse após o delete).
create or replace function public.set_artigo_categorias(_artigo_id uuid, _cat_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if not exists (select 1 from artigos where id = _artigo_id and tenant_id = v_tenant) then
    raise exception 'Tecido não encontrado';
  end if;
  delete from artigo_categorias_tecido where artigo_id = _artigo_id;
  if array_length(_cat_ids, 1) is not null then
    insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id)
    select _artigo_id, unnest(_cat_ids);
  end if;
end $$;
revoke execute on function public.set_artigo_categorias(uuid, uuid[]) from anon;

-- 4) Excluir UMA variante (cor) com guarda de uso. Retorna a foto p/ o cliente limpar o storage
--    DEPOIS (o cliente removia a foto ANTES do delete: se o delete falhava, sobrava foto órfã).
create or replace function public.excluir_variante_tecido(_variante_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_artigo uuid; v_foto text; v_n int;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  select artigo_id, foto_url into v_artigo, v_foto
    from variantes_tecido where id = _variante_id and tenant_id = v_tenant;
  if v_artigo is null then raise exception 'Variante não encontrada'; end if;

  select
    (select count(*) from ocs_tecido_itens          where variante_tecido_id = _variante_id)
  + (select count(*) from modelo_tecido_variantes   where variante_tecido_id = _variante_id)
  + (select count(*) from cad_tecido_variantes      where variante_tecido_id = _variante_id)
  + (select count(*) from ordens_saida_tecido_itens where variante_tecido_id = _variante_id)
  + (select count(*) from estoque_tecido_baixas     where variante_tecido_id = _variante_id)
  + (select count(*) from modelo_tecido_oc_links    where variante_tecido_id = _variante_id)
  into v_n;

  if v_n > 0 then
    raise exception 'Não é possível excluir esta cor: ela está em uso em % registro(s) (OCs, estoque, modelos, CAD ou ordens de saída). Zere/estorne o uso antes.', v_n;
  end if;

  delete from variantes_tecido where id = _variante_id and tenant_id = v_tenant;
  return jsonb_build_object('foto_url', v_foto);
end $$;
revoke execute on function public.excluir_variante_tecido(uuid) from anon;

-- 5) Excluir um TECIDO inteiro com guarda. Bloqueia se qualquer variante estiver em uso; senão
--    retorna as fotos das variantes p/ o cliente limpar o storage (o delete do artigo cascateia
--    variantes + categorias, mas NÃO cascateia OC/estoque/modelo/CAD/ordem — por isso a guarda).
create or replace function public.excluir_tecido(_artigo_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_n int; v_fotos jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if not exists (select 1 from artigos where id = _artigo_id and tenant_id = v_tenant) then
    raise exception 'Tecido não encontrado';
  end if;

  select
    -- referências de nível ARTIGO
    (select count(*) from ocs_tecido_itens where artigo_id = _artigo_id)
  + (select count(*) from modelo_tecidos   where artigo_id = _artigo_id)
  + (select count(*) from cad_tecidos      where artigo_id = _artigo_id)
    -- referências de nível VARIANTE (qualquer cor deste tecido)
  + (select count(*) from modelo_tecido_variantes   x join variantes_tecido v on v.id=x.variante_tecido_id where v.artigo_id = _artigo_id)
  + (select count(*) from cad_tecido_variantes      x join variantes_tecido v on v.id=x.variante_tecido_id where v.artigo_id = _artigo_id)
  + (select count(*) from ordens_saida_tecido_itens x join variantes_tecido v on v.id=x.variante_tecido_id where v.artigo_id = _artigo_id)
  + (select count(*) from estoque_tecido_baixas     x join variantes_tecido v on v.id=x.variante_tecido_id where v.artigo_id = _artigo_id)
  + (select count(*) from modelo_tecido_oc_links    x join variantes_tecido v on v.id=x.variante_tecido_id where v.artigo_id = _artigo_id)
  into v_n;

  if v_n > 0 then
    raise exception 'Não é possível excluir este tecido: ele está em uso em % registro(s) (OCs, estoque, modelos, CAD ou ordens de saída). Remova/zere o uso antes.', v_n;
  end if;

  select coalesce(jsonb_agg(foto_url) filter (where foto_url is not null), '[]'::jsonb)
    into v_fotos from variantes_tecido where artigo_id = _artigo_id;

  delete from artigos where id = _artigo_id and tenant_id = v_tenant; -- CASCADE: variantes + categorias
  return jsonb_build_object('fotos', v_fotos);
end $$;
revoke execute on function public.excluir_tecido(uuid) from anon;

select pg_notify('pgrst', 'reload schema');
