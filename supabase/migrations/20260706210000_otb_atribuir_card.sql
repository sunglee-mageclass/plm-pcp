-- Atribuir um card "não classificado" a uma (subcoleção, semana) direto do OTB: atualiza o
-- card e sobe a qtd da semana (+1) e, se o card tiver categoria, a qtd daquela categoria (+1).
-- Cria a linha da semana/categoria se ainda não existir. Assim OTB e Planejamento batem.
create or replace function public.otb_atribuir_card(_modelo_id uuid, _subcolecao_id uuid, _semana text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_colecao uuid;
  v_cat uuid;
  v_subnome text;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if coalesce(_semana,'') = '' then raise exception 'Informe a semana'; end if;

  select colecao_id, categoria_principal_id into v_colecao, v_cat
    from modelos where id = _modelo_id and tenant_id = v_tenant;
  if not found or v_colecao is null then raise exception 'Card não encontrado ou sem coleção'; end if;

  if _subcolecao_id is not null then
    select nome into v_subnome from colecao_subcolecoes where id = _subcolecao_id and colecao_id = v_colecao and tenant_id = v_tenant;
    if v_subnome is null then raise exception 'Subcoleção inválida'; end if;
  end if;

  update modelos set subcolecao = v_subnome, semana = _semana
    where id = _modelo_id and tenant_id = v_tenant;

  insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada)
    values (v_colecao, _subcolecao_id, _semana, 1)
    on conflict (colecao_id, subcolecao_id, semana)
    do update set qtd_planejada = colecao_semanas.qtd_planejada + 1;

  if v_cat is not null then
    insert into colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd)
      values (v_colecao, _subcolecao_id, _semana, v_cat, 1)
      on conflict (colecao_id, subcolecao_id, semana, categoria_id)
      do update set qtd = colecao_semana_categorias.qtd + 1;
  end if;
end $$;

revoke execute on function public.otb_atribuir_card(uuid, uuid, text) from anon;

select pg_notify('pgrst', 'reload schema');
