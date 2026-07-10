-- Correções da 2ª rodada de review do time (OTB Poder de Venda).

-- [MÉD #2] excluir_mix_padrao: guarda amigável se o padrão está em uso por coleção
-- (FK colecoes.mix_padrao_id é NO ACTION → hoje estoura 23503 cru).
create or replace function public.excluir_mix_padrao(_id uuid)
returns void
language plpgsql
set search_path to 'public'
as $$
begin
  if exists (select 1 from public.colecoes where mix_padrao_id = _id) then
    raise exception 'Padrão em uso por uma ou mais coleções — troque o padrão nelas antes de excluir.';
  end if;
  delete from public.mix_padroes where id = _id;  -- RLS restringe ao tenant
end $$;
revoke execute on function public.excluir_mix_padrao(uuid) from public, anon;
grant execute on function public.excluir_mix_padrao(uuid) to authenticated;

-- [BAIXA #5] salvar_mix_padrao: aplica o gate opt-in do módulo otb (escrita também).
create or replace function public.salvar_mix_padrao(_id uuid, _nome text, _linhas jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_id uuid := _id; v_lin jsonb; v_cat jsonb; v_lin_id uuid; v_i int := 0; v_j int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  if coalesce(btrim(_nome), '') = '' then raise exception 'Informe o nome do padrão.'; end if;

  if v_id is null then
    insert into public.mix_padroes (nome) values (_nome) returning id into v_id;
  else
    update public.mix_padroes set nome = _nome where id = v_id;
    if not found then raise exception 'Padrão não encontrado.'; end if;
    delete from public.mix_padrao_linhas where padrao_id = v_id;
  end if;

  for v_lin in select value from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    insert into public.mix_padrao_linhas (padrao_id, linha_id, pct, prof_cor, cores, ordem)
    values (v_id, nullif(v_lin->>'linha_id', '')::uuid, coalesce((v_lin->>'pct')::numeric, 0),
            greatest(0, coalesce((v_lin->>'prof_cor')::int, 0)), greatest(0, coalesce((v_lin->>'cores')::int, 0)), v_i)
    returning id into v_lin_id;
    v_i := v_i + 1;
    v_j := 0;
    for v_cat in select value from jsonb_array_elements(coalesce(v_lin->'categorias', '[]'::jsonb)) loop
      insert into public.mix_padrao_categorias (padrao_linha_id, categoria_id, subcategoria1_id, preco_min, preco_max, ordem)
      values (v_lin_id, nullif(v_cat->>'categoria_id', '')::uuid, nullif(v_cat->>'subcategoria1_id', '')::uuid,
              greatest(0, coalesce((v_cat->>'preco_min')::numeric, 0)), greatest(0, coalesce((v_cat->>'preco_max')::numeric, 0)), v_j);
      v_j := v_j + 1;
    end loop;
  end loop;
  return v_id;
end $$;
revoke execute on function public.salvar_mix_padrao(uuid, text, jsonb) from public, anon;
grant execute on function public.salvar_mix_padrao(uuid, text, jsonb) to authenticated;

-- [BAIXA #5] salvar_colecao_pv: aplica o gate opt-in também (mantém validações da rodada 1).
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
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  if coalesce(btrim(_header->>'nome'), '') = '' then raise exception 'Informe o nome da coleção.'; end if;

  if exists (select 1 from jsonb_array_elements(coalesce(_subcolecoes,'[]'::jsonb)) e where coalesce(btrim(e.value->>'nome'),'') = '') then
    raise exception 'Cada subcoleção precisa de um nome.';
  end if;
  select count(*), count(distinct lower(btrim(e.value->>'nome'))) into v_n_sub, v_n_distintos
    from jsonb_array_elements(coalesce(_subcolecoes,'[]'::jsonb)) e;
  if v_n_sub <> v_n_distintos then raise exception 'Há subcoleções com o mesmo nome — use nomes distintos.'; end if;
  if nullif(_header->>'mix_padrao_id','') is not null
     and not exists (select 1 from public.mix_padroes where id = (_header->>'mix_padrao_id')::uuid and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Padrão do mix inválido.';
  end if;

  if v_id is null then
    insert into public.colecoes (nome, tipo, mes_id, ano_id, mix_padrao_id, poder_venda_meta, perda_markup, status)
    values (_header->>'nome', 'poder_venda', nullif(_header->>'mes_id','')::uuid, nullif(_header->>'ano_id','')::uuid,
            nullif(_header->>'mix_padrao_id','')::uuid, nullif(_header->>'poder_venda_meta','')::numeric,
            greatest(0, coalesce((_header->>'perda_markup')::numeric, 25)), 'rascunho')
    returning id into v_id;
  else
    update public.colecoes set
      nome = _header->>'nome', mes_id = nullif(_header->>'mes_id','')::uuid, ano_id = nullif(_header->>'ano_id','')::uuid,
      mix_padrao_id = nullif(_header->>'mix_padrao_id','')::uuid, poder_venda_meta = nullif(_header->>'poder_venda_meta','')::numeric,
      perda_markup = greatest(0, coalesce((_header->>'perda_markup')::numeric, 25))
    where id = v_id and tipo = 'poder_venda';
    if not found then raise exception 'Coleção não encontrada.'; end if;
    delete from public.colecao_pv_itens where colecao_id = v_id;
    delete from public.colecao_subcolecoes where colecao_id = v_id;
  end if;

  for v_sub in select value from jsonb_array_elements(coalesce(_subcolecoes, '[]'::jsonb)) loop
    insert into public.colecao_subcolecoes (colecao_id, nome, ordem, data_lancamento, semanas)
    values (v_id, btrim(v_sub->>'nome'), v_si, nullif(v_sub->>'data_lancamento','')::date,
            coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(v_sub->'semanas','[]'::jsonb)) x), '{}'::int[]))
    returning id into v_sub_id;
    v_si := v_si + 1;
    v_ii := 0;
    for v_item in select value from jsonb_array_elements(coalesce(v_sub->'itens', '[]'::jsonb)) loop
      insert into public.colecao_pv_itens (colecao_id, subcolecao_id, linha_id, prof_cor, cores,
        categoria_id, subcategoria1_id, preco_min, preco_max, qtd_semanas, ordem)
      values (v_id, v_sub_id, nullif(v_item->>'linha_id','')::uuid,
              greatest(0, coalesce((v_item->>'prof_cor')::int, 0)), greatest(0, coalesce((v_item->>'cores')::int, 0)),
              nullif(v_item->>'categoria_id','')::uuid, nullif(v_item->>'subcategoria1_id','')::uuid,
              greatest(0, coalesce((v_item->>'preco_min')::numeric, 0)), greatest(0, coalesce((v_item->>'preco_max')::numeric, 0)),
              coalesce(v_item->'qtd_semanas', '{}'::jsonb), v_ii);
      v_ii := v_ii + 1;
    end loop;
  end loop;
  return v_id;
end $$;
revoke execute on function public.salvar_colecao_pv(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_colecao_pv(uuid, jsonb, jsonb) to authenticated;

-- [MÉD #1 + BAIXA #6] otb_confirmar_pv: parse seguro de qtd_semanas (ignora não-inteiro) e,
-- ao reconfirmar, PROPAGA mês/ano/data_lancamento p/ os cards intocados sobreviventes.
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
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501'; end if;
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
    where it.colecao_id = _colecao_id and it.tenant_id = v_tenant and e.value ~ '^[0-9]+$' and e.value::int > 0
    group by sc.nome, sc.data_lancamento, it.linha_id, it.categoria_id, it.subcategoria1_id, e.key
  loop
    select count(*) into v_existing from modelos
      where tenant_id = v_tenant and colecao_id = _colecao_id
        and coalesce(semana,'') = v_bk.semana and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
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
             'em_planejamento', 1, '', null, '{}'::uuid[], '{}'::text[], '{}'::text[], ''
      from generate_series(1, v_diff);
      v_criados := v_criados + v_diff;
    elsif v_diff < 0 then
      select array_agg(id) into v_removable from (
        select id from modelos
        where tenant_id = v_tenant and colecao_id = _colecao_id
          and coalesce(semana,'') = v_bk.semana and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
          and coalesce(categoria_principal_id::text,'') = coalesce(v_bk.categoria_id::text,'')
          and coalesce(subcategoria1_id::text,'') = coalesce(v_bk.subcategoria1_id::text,'')
          and coalesce(linha_id::text,'') = coalesce(v_bk.linha_id::text,'')
          and status_planejamento in ('em_planejamento','reprovado')
          and coalesce(nome,'') = '' and estilista_id is null and preco_venda is null and lancado = false
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
    and coalesce(m.nome,'') = '' and m.estilista_id is null and m.preco_venda is null and m.lancado = false
    and cardinality(coalesce(m.fotos_modelo,'{}')) = 0
    and not exists (
      select 1 from colecao_pv_itens it
      join colecao_subcolecoes sc on sc.id = it.subcolecao_id
      cross join lateral jsonb_each_text(it.qtd_semanas) as e(key, value)
      where it.colecao_id = _colecao_id and e.value ~ '^[0-9]+$' and e.value::int > 0
        and coalesce(sc.nome,'') = coalesce(m.subcolecao,'') and e.key = coalesce(m.semana,'')
        and coalesce(it.categoria_id::text,'') = coalesce(m.categoria_principal_id::text,'')
        and coalesce(it.subcategoria1_id::text,'') = coalesce(m.subcategoria1_id::text,'')
        and coalesce(it.linha_id::text,'') = coalesce(m.linha_id::text,'')
    );
  get diagnostics v_diff = row_count;
  v_removidos := v_removidos + v_diff;

  -- Propaga mês/ano p/ os cards intocados sobreviventes (herdam da coleção).
  update modelos m set mes_id = v_col.mes_id, ano_id = v_col.ano_id
  where m.tenant_id = v_tenant and m.colecao_id = _colecao_id
    and m.status_planejamento in ('em_planejamento','reprovado')
    and coalesce(m.nome,'') = '' and m.estilista_id is null and m.preco_venda is null and m.lancado = false
    and (m.mes_id is distinct from v_col.mes_id or m.ano_id is distinct from v_col.ano_id);
  -- Propaga a data de lançamento da subcoleção (casa por nome) p/ os intocados.
  update modelos m set data_lancamento = sc.data_lancamento
  from colecao_subcolecoes sc
  where sc.colecao_id = _colecao_id and coalesce(sc.nome,'') = coalesce(m.subcolecao,'')
    and m.tenant_id = v_tenant and m.colecao_id = _colecao_id
    and m.status_planejamento in ('em_planejamento','reprovado')
    and coalesce(m.nome,'') = '' and m.estilista_id is null and m.preco_venda is null and m.lancado = false
    and m.data_lancamento is distinct from sc.data_lancamento;

  update colecoes set status = 'confirmada' where id = _colecao_id and tenant_id = v_tenant;
  perform set_config('app.otb_reconciling', 'off', true);
  return jsonb_build_object('criados', v_criados, 'removidos', v_removidos);
end $$;

select pg_notify('pgrst', 'reload schema');
