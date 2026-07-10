-- Coleção PV: semanas e data de lançamento passam a ser POR SUBCOLEÇÃO (não global).
-- Cada subcoleção escolhe quais das semanas 1–5 usa (colecao_subcolecoes.semanas) e tem
-- UMA data de lançamento (colecao_subcolecoes.data_lancamento), que o card herda em
-- modelos.data_lancamento ao confirmar. Aditivo — o fluxo por Orçamento ignora as colunas.

alter table public.colecao_subcolecoes
  add column if not exists data_lancamento date,
  add column if not exists semanas int[] not null default '{}';

-- salvar_colecao_pv: agora grava semanas[] + data_lancamento por subcoleção.
create or replace function public.salvar_colecao_pv(_id uuid, _header jsonb, _subcolecoes jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_id uuid := _id; v_sub jsonb; v_item jsonb; v_sub_id uuid; v_si int := 0; v_ii int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if coalesce(btrim(_header->>'nome'), '') = '' then raise exception 'Informe o nome da coleção.'; end if;

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
    values (v_id, coalesce(nullif(btrim(v_sub->>'nome'),''), 'Subcoleção'), v_si,
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

-- otb_confirmar_pv: card herda a data_lancamento da subcoleção.
create or replace function public.otb_confirmar_pv(_colecao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_col record; v_bk record;
  v_criados int := 0; v_removidos int := 0; v_existing int; v_diff int; v_removable uuid[];
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  select * into v_col from colecoes where id = _colecao_id and tenant_id = v_tenant and tipo = 'poder_venda';
  if not found then raise exception 'Coleção (poder de venda) não encontrada'; end if;

  perform set_config('app.otb_reconciling', 'on', true);

  for v_bk in
    select sc.nome as subcol, sc.data_lancamento, it.linha_id, it.categoria_id, it.subcategoria1_id,
           e.key as semana, sum(e.value::int) as target
    from colecao_pv_itens it
    join colecao_subcolecoes sc on sc.id = it.subcolecao_id
    cross join lateral jsonb_each_text(it.qtd_semanas) as e(key, value)
    where it.colecao_id = _colecao_id and it.tenant_id = v_tenant and e.value::int > 0
    group by sc.nome, sc.data_lancamento, it.linha_id, it.categoria_id, it.subcategoria1_id, e.key
  loop
    select count(*) into v_existing from modelos
      where tenant_id = v_tenant and colecao_id = _colecao_id
        and coalesce(semana,'') = v_bk.semana
        and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
        and coalesce(categoria_principal_id::text,'') = coalesce(v_bk.categoria_id::text,'')
        and coalesce(subcategoria1_id::text,'') = coalesce(v_bk.subcategoria1_id::text,'')
        and coalesce(linha_id::text,'') = coalesce(v_bk.linha_id::text,'');
    v_diff := v_bk.target - v_existing;

    if v_diff > 0 then
      insert into modelos (tenant_id, colecao_id, colecao, subcolecao, semana, data_lancamento, linha_id,
                           categoria_principal_id, subcategoria1_id, mes_id, ano_id,
                           status_planejamento, versao, nome, preco_venda,
                           tecidos_planejados, fotos_modelo, fotos_referencia, observacoes_gerais)
      select v_tenant, _colecao_id, v_col.nome, v_bk.subcol, v_bk.semana, v_bk.data_lancamento, v_bk.linha_id,
             v_bk.categoria_id, v_bk.subcategoria1_id, v_col.mes_id, v_col.ano_id,
             'em_planejamento', 1, '', null,
             '{}'::uuid[], '{}'::text[], '{}'::text[], ''
      from generate_series(1, v_diff);
      v_criados := v_criados + v_diff;

    elsif v_diff < 0 then
      select array_agg(id) into v_removable from (
        select id from modelos
        where tenant_id = v_tenant and colecao_id = _colecao_id
          and coalesce(semana,'') = v_bk.semana
          and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
          and coalesce(categoria_principal_id::text,'') = coalesce(v_bk.categoria_id::text,'')
          and coalesce(subcategoria1_id::text,'') = coalesce(v_bk.subcategoria1_id::text,'')
          and coalesce(linha_id::text,'') = coalesce(v_bk.linha_id::text,'')
          and status_planejamento in ('em_planejamento','reprovado')
          and coalesce(nome,'') = '' and estilista_id is null
          and preco_venda is null and lancado = false
          and cardinality(coalesce(fotos_modelo,'{}')) = 0
        limit (v_existing - v_bk.target)
      ) t;
      if v_removable is not null then
        delete from modelos where id = any(v_removable);
        v_removidos := v_removidos + array_length(v_removable, 1);
      end if;
    end if;
  end loop;

  delete from modelos m
  where m.tenant_id = v_tenant and m.colecao_id = _colecao_id
    and m.status_planejamento in ('em_planejamento','reprovado')
    and coalesce(m.nome,'') = '' and m.estilista_id is null
    and m.preco_venda is null and m.lancado = false
    and cardinality(coalesce(m.fotos_modelo,'{}')) = 0
    and not exists (
      select 1 from colecao_pv_itens it
      join colecao_subcolecoes sc on sc.id = it.subcolecao_id
      cross join lateral jsonb_each_text(it.qtd_semanas) as e(key, value)
      where it.colecao_id = _colecao_id and e.value::int > 0
        and coalesce(sc.nome,'') = coalesce(m.subcolecao,'')
        and e.key = coalesce(m.semana,'')
        and coalesce(it.categoria_id::text,'') = coalesce(m.categoria_principal_id::text,'')
        and coalesce(it.subcategoria1_id::text,'') = coalesce(m.subcategoria1_id::text,'')
        and coalesce(it.linha_id::text,'') = coalesce(m.linha_id::text,'')
    );
  get diagnostics v_diff = row_count;
  v_removidos := v_removidos + v_diff;

  update colecoes set status = 'confirmada' where id = _colecao_id and tenant_id = v_tenant;
  perform set_config('app.otb_reconciling', 'off', true);
  return jsonb_build_object('criados', v_criados, 'removidos', v_removidos);
end $$;

select pg_notify('pgrst', 'reload schema');
