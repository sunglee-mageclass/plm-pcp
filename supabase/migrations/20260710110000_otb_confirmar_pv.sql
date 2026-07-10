-- Fase 3: confirmar uma coleção PODER DE VENDA gera os cards no Planejamento.
-- Espelha otb_confirmar (reconciliação por bucket + guarda app.otb_reconciling), mas o
-- bucket é (subcoleção × linha × categoria × sub × semana) e o card nasce SEM preço de
-- venda (a faixa mín–máx fica em colecao_pv_itens como referência). Total do bucket = a
-- qtd daquela semana no jsonb qtd_semanas.

create or replace function public.otb_confirmar_pv(_colecao_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_col record;
  v_bk record;
  v_criados int := 0; v_removidos int := 0;
  v_existing int; v_diff int; v_removable uuid[];
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  select * into v_col from colecoes where id = _colecao_id and tenant_id = v_tenant and tipo = 'poder_venda';
  if not found then raise exception 'Coleção (poder de venda) não encontrada'; end if;

  perform set_config('app.otb_reconciling', 'on', true);

  for v_bk in
    -- Bucket = (subcoleção, linha, categoria, sub, semana). SOMA os targets: se dois itens
    -- caírem no mesmo bucket, a qtd é a soma (não o maior) — mantém o confirmar idempotente.
    select sc.nome as subcol, it.linha_id, it.categoria_id, it.subcategoria1_id,
           e.key as semana, sum(e.value::int) as target
    from colecao_pv_itens it
    join colecao_subcolecoes sc on sc.id = it.subcolecao_id
    cross join lateral jsonb_each_text(it.qtd_semanas) as e(key, value)
    where it.colecao_id = _colecao_id and it.tenant_id = v_tenant and e.value::int > 0
    group by sc.nome, it.linha_id, it.categoria_id, it.subcategoria1_id, e.key
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
      insert into modelos (tenant_id, colecao_id, colecao, subcolecao, semana, linha_id,
                           categoria_principal_id, subcategoria1_id, mes_id, ano_id,
                           status_planejamento, versao, nome, preco_venda,
                           tecidos_planejados, fotos_modelo, fotos_referencia, observacoes_gerais)
      select v_tenant, _colecao_id, v_col.nome, v_bk.subcol, v_bk.semana, v_bk.linha_id,
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

  -- Órfãos: cards VAZIOS da coleção que não batem com nenhum bucket atual (sobras de
  -- itens/semanas removidos). Só remove cards intocados (nunca apaga o que o usuário mexeu).
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

revoke execute on function public.otb_confirmar_pv(uuid) from public, anon;
grant execute on function public.otb_confirmar_pv(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
