-- Correções pós-revisão do time (OTB Poder de Venda).

-- [ALTO] fn_otb_sync_semana (gatilho em modelos p/ o fluxo ORÇAMENTO) disparava também
-- para cards de coleção POR PODER DE VENDA quando a guarda app.otb_reconciling está
-- desligada (ex.: editar/apagar card no Planejamento após o confirmar), gravando linhas
-- órfãs em colecao_semanas/colecao_semana_categorias (tabelas do outro fluxo). Sai cedo p/ PV.
create or replace function public.fn_otb_sync_semana()
returns trigger
language plpgsql
as $function$
declare
  v_old_sub uuid; v_new_sub uuid;
  v_bucket_changed boolean;
begin
  if coalesce(current_setting('app.otb_reconciling', true), '') = 'on' then
    return coalesce(NEW, OLD);
  end if;

  -- Coleção Poder de Venda não usa colecao_semanas (isso é do fluxo Orçamento).
  if (select tipo from public.colecoes where id = coalesce(NEW.colecao_id, OLD.colecao_id)) = 'poder_venda' then
    return coalesce(NEW, OLD);
  end if;

  v_bucket_changed := (TG_OP <> 'UPDATE')
    or OLD.colecao_id is distinct from NEW.colecao_id
    or coalesce(OLD.subcolecao,'') is distinct from coalesce(NEW.subcolecao,'')
    or coalesce(OLD.semana,'') is distinct from coalesce(NEW.semana,'')
    or OLD.categoria_principal_id is distinct from NEW.categoria_principal_id;

  if (TG_OP in ('DELETE','UPDATE')) and v_bucket_changed
     and OLD.colecao_id is not null and coalesce(OLD.semana,'') <> '' then
    if coalesce(OLD.subcolecao,'') <> '' then
      select id into v_old_sub from public.colecao_subcolecoes
        where colecao_id = OLD.colecao_id and nome = OLD.subcolecao limit 1;
    else v_old_sub := null; end if;
    update public.colecao_semanas set qtd_planejada = greatest(0, qtd_planejada - 1)
      where colecao_id = OLD.colecao_id and coalesce(semana,'') = coalesce(OLD.semana,'')
        and coalesce(subcolecao_id::text,'') = coalesce(v_old_sub::text,'');
    if OLD.categoria_principal_id is not null then
      update public.colecao_semana_categorias set qtd = greatest(0, qtd - 1)
        where colecao_id = OLD.colecao_id and semana = coalesce(OLD.semana,'')
          and coalesce(subcolecao_id::text,'') = coalesce(v_old_sub::text,'')
          and categoria_id = OLD.categoria_principal_id;
    end if;
  end if;

  if (TG_OP in ('INSERT','UPDATE')) and v_bucket_changed
     and NEW.colecao_id is not null and coalesce(NEW.semana,'') <> '' then
    if coalesce(NEW.subcolecao,'') <> '' then
      select id into v_new_sub from public.colecao_subcolecoes
        where colecao_id = NEW.colecao_id and nome = NEW.subcolecao limit 1;
    else v_new_sub := null; end if;
    insert into public.colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada)
      values (NEW.colecao_id, v_new_sub, NEW.semana, 1)
      on conflict (colecao_id, subcolecao_id, semana)
      do update set qtd_planejada = colecao_semanas.qtd_planejada + 1;
    if NEW.categoria_principal_id is not null then
      insert into public.colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd)
        values (NEW.colecao_id, v_new_sub, NEW.semana, NEW.categoria_principal_id, 1)
        on conflict (colecao_id, subcolecao_id, semana, categoria_id)
        do update set qtd = colecao_semana_categorias.qtd + 1;
    end if;
  end if;

  return coalesce(NEW, OLD);
end $function$;

-- [MÉDIO] salvar_colecao_pv: valida nome de subcoleção (obrigatório + único — o bucket do
-- otb_confirmar_pv casa por NOME) e que o mix_padrao_id pertence ao tenant (evita referência
-- pendurada cross-tenant). Erros amigáveis em vez de violar unique cru.
create or replace function public.salvar_colecao_pv(_id uuid, _header jsonb, _subcolecoes jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_id uuid := _id; v_sub jsonb; v_item jsonb; v_sub_id uuid; v_si int := 0; v_ii int;
  v_n_sub int; v_n_distintos int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if coalesce(btrim(_header->>'nome'), '') = '' then raise exception 'Informe o nome da coleção.'; end if;

  if exists (select 1 from jsonb_array_elements(coalesce(_subcolecoes,'[]'::jsonb)) e where coalesce(btrim(e.value->>'nome'),'') = '') then
    raise exception 'Cada subcoleção precisa de um nome.';
  end if;
  select count(*), count(distinct lower(btrim(e.value->>'nome')))
    into v_n_sub, v_n_distintos
    from jsonb_array_elements(coalesce(_subcolecoes,'[]'::jsonb)) e;
  if v_n_sub <> v_n_distintos then
    raise exception 'Há subcoleções com o mesmo nome — use nomes distintos.';
  end if;
  if nullif(_header->>'mix_padrao_id','') is not null
     and not exists (select 1 from public.mix_padroes where id = (_header->>'mix_padrao_id')::uuid and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Padrão do mix inválido.';
  end if;

  if v_id is null then
    insert into public.colecoes (nome, tipo, mes_id, ano_id, mix_padrao_id, poder_venda_meta, perda_markup, status)
    values (_header->>'nome', 'poder_venda', nullif(_header->>'mes_id','')::uuid, nullif(_header->>'ano_id','')::uuid,
            nullif(_header->>'mix_padrao_id','')::uuid, nullif(_header->>'poder_venda_meta','')::numeric,
            coalesce((_header->>'perda_markup')::numeric, 25), 'rascunho')
    returning id into v_id;
  else
    update public.colecoes set
      nome = _header->>'nome', mes_id = nullif(_header->>'mes_id','')::uuid, ano_id = nullif(_header->>'ano_id','')::uuid,
      mix_padrao_id = nullif(_header->>'mix_padrao_id','')::uuid, poder_venda_meta = nullif(_header->>'poder_venda_meta','')::numeric,
      perda_markup = coalesce((_header->>'perda_markup')::numeric, 25)
    where id = v_id and tipo = 'poder_venda';
    if not found then raise exception 'Coleção não encontrada.'; end if;
    delete from public.colecao_pv_itens where colecao_id = v_id;
    delete from public.colecao_subcolecoes where colecao_id = v_id;
  end if;

  for v_sub in select value from jsonb_array_elements(coalesce(_subcolecoes, '[]'::jsonb)) loop
    insert into public.colecao_subcolecoes (colecao_id, nome, ordem, data_lancamento, semanas)
    values (v_id, btrim(v_sub->>'nome'), v_si,
            nullif(v_sub->>'data_lancamento','')::date,
            coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(v_sub->'semanas','[]'::jsonb)) x), '{}'::int[]))
    returning id into v_sub_id;
    v_si := v_si + 1;

    v_ii := 0;
    for v_item in select value from jsonb_array_elements(coalesce(v_sub->'itens', '[]'::jsonb)) loop
      insert into public.colecao_pv_itens (colecao_id, subcolecao_id, linha_id, prof_cor, cores,
        categoria_id, subcategoria1_id, preco_min, preco_max, qtd_semanas, ordem)
      values (v_id, v_sub_id, nullif(v_item->>'linha_id','')::uuid,
              coalesce((v_item->>'prof_cor')::int, 0), coalesce((v_item->>'cores')::int, 0),
              nullif(v_item->>'categoria_id','')::uuid, nullif(v_item->>'subcategoria1_id','')::uuid,
              coalesce((v_item->>'preco_min')::numeric, 0), coalesce((v_item->>'preco_max')::numeric, 0),
              coalesce(v_item->'qtd_semanas', '{}'::jsonb), v_ii);
      v_ii := v_ii + 1;
    end loop;
  end loop;

  return v_id;
end $$;

select pg_notify('pgrst', 'reload schema');
