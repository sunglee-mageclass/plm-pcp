-- otb_confirmar: além de reconciliar cada bucket (subcoleção×semana×categoria), agora faz
-- uma PASSADA DE LIMPEZA que remove os cards VAZIOS (só com os campos que o OTB preenche) e
-- em Planejamento/Rejeitado que NÃO pertencem a nenhum bucket atual — sobras do modelo antigo
-- (subcoleção vazia) ou de semanas/subcoleções/categorias que saíram do plano. Sem isso, o
-- total do Planejamento não fecha com o total do OTB (ex.: Resort 27 marcava 20 no OTB mas
-- tinha 133 cards). Cards que o usuário mexeu ou que avançaram (status 'planejado' etc.) ficam.
CREATE OR REPLACE FUNCTION public.otb_confirmar(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_col record;
  v_bk record;
  v_criados int := 0; v_removidos int := 0; v_mantidos int := 0;
  v_existing int; v_diff int; v_removable uuid[]; v_orphans int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  select * into v_col from colecoes where id = _colecao_id and tenant_id = v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;

  perform set_config('app.otb_reconciling', 'on', true);

  for v_bk in
    select cs.semana, sc.nome as subcol, csc.categoria_id, csc.qtd as target
    from colecao_semanas cs
    left join colecao_subcolecoes sc on sc.id = cs.subcolecao_id
    join colecao_semana_categorias csc
      on csc.colecao_id = cs.colecao_id
     and coalesce(csc.subcolecao_id::text,'') = coalesce(cs.subcolecao_id::text,'')
     and csc.semana = cs.semana
    where cs.colecao_id = _colecao_id and cs.tenant_id = v_tenant
    union all
    select cs.semana, sc.nome as subcol, null::uuid as categoria_id, cs.qtd_planejada as target
    from colecao_semanas cs
    left join colecao_subcolecoes sc on sc.id = cs.subcolecao_id
    where cs.colecao_id = _colecao_id and cs.tenant_id = v_tenant
      and not exists (
        select 1 from colecao_semana_categorias csc
        where csc.colecao_id = cs.colecao_id
          and coalesce(csc.subcolecao_id::text,'') = coalesce(cs.subcolecao_id::text,'')
          and csc.semana = cs.semana
      )
  loop
    select count(*) into v_existing from modelos
      where tenant_id = v_tenant and colecao_id = _colecao_id
        and coalesce(semana,'') = v_bk.semana
        and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
        and coalesce(categoria_principal_id::text,'') = coalesce(v_bk.categoria_id::text,'');
    v_diff := v_bk.target - v_existing;

    if v_diff > 0 then
      insert into modelos (tenant_id, colecao_id, colecao, subcolecao, semana, categoria_principal_id,
                           mes_id, ano_id, status_planejamento, versao,
                           nome, tecidos_planejados, fotos_modelo, fotos_referencia, observacoes_gerais)
      select v_tenant, _colecao_id, v_col.nome, v_bk.subcol, v_bk.semana, v_bk.categoria_id,
             v_col.mes_id, v_col.ano_id, 'em_planejamento', 1,
             '', '{}'::uuid[], '{}'::text[], '{}'::text[], ''
      from generate_series(1, v_diff);
      v_criados := v_criados + v_diff;

    elsif v_diff < 0 then
      select array_agg(id) into v_removable from (
        select id from modelos
        where tenant_id = v_tenant and colecao_id = _colecao_id
          and coalesce(semana,'') = v_bk.semana
          and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
          and coalesce(categoria_principal_id::text,'') = coalesce(v_bk.categoria_id::text,'')
          and status_planejamento in ('em_planejamento','reprovado')
          and coalesce(nome,'') = '' and estilista_id is null
          and linha_id is null and subcategoria1_id is null and subcategoria2_id is null
          and preco_venda is null and data_lancamento is null and lancado = false
          and origem = 'interno' and coalesce(observacoes_gerais,'') = ''
          and cardinality(coalesce(fotos_modelo,'{}')) = 0
          and cardinality(coalesce(fotos_referencia,'{}')) = 0
          and cardinality(tecidos_planejados) = 0
        order by created_at desc
        limit (-v_diff)
      ) t;
      if v_removable is not null then
        delete from modelos where id = any(v_removable);
        v_removidos := v_removidos + array_length(v_removable, 1);
      end if;
      v_mantidos := v_mantidos + (v_existing - v_bk.target) - coalesce(array_length(v_removable,1),0);
    end if;
  end loop;

  -- Limpeza de órfãos: cards vazios em Planejamento/Rejeitado que não batem com bucket algum.
  with buckets as (
    select cs.semana, sc.nome as subcol, csc.categoria_id
    from colecao_semanas cs
    left join colecao_subcolecoes sc on sc.id = cs.subcolecao_id
    join colecao_semana_categorias csc
      on csc.colecao_id = cs.colecao_id
     and coalesce(csc.subcolecao_id::text,'') = coalesce(cs.subcolecao_id::text,'')
     and csc.semana = cs.semana
    where cs.colecao_id = _colecao_id and cs.tenant_id = v_tenant
    union all
    select cs.semana, sc.nome, null::uuid
    from colecao_semanas cs
    left join colecao_subcolecoes sc on sc.id = cs.subcolecao_id
    where cs.colecao_id = _colecao_id and cs.tenant_id = v_tenant
      and not exists (
        select 1 from colecao_semana_categorias csc
        where csc.colecao_id = cs.colecao_id
          and coalesce(csc.subcolecao_id::text,'') = coalesce(cs.subcolecao_id::text,'')
          and csc.semana = cs.semana
      )
  )
  delete from modelos m
  where m.tenant_id = v_tenant and m.colecao_id = _colecao_id
    and m.status_planejamento in ('em_planejamento','reprovado')
    and coalesce(m.nome,'') = '' and m.estilista_id is null
    and m.linha_id is null and m.subcategoria1_id is null and m.subcategoria2_id is null
    and m.preco_venda is null and m.data_lancamento is null and m.lancado = false
    and m.origem = 'interno' and coalesce(m.observacoes_gerais,'') = ''
    and cardinality(coalesce(m.fotos_modelo,'{}')) = 0
    and cardinality(coalesce(m.fotos_referencia,'{}')) = 0
    and cardinality(m.tecidos_planejados) = 0
    and not exists (
      select 1 from buckets b
      where coalesce(m.semana,'') = b.semana
        and coalesce(m.subcolecao,'') = coalesce(b.subcol,'')
        and coalesce(m.categoria_principal_id::text,'') = coalesce(b.categoria_id::text,'')
    );
  get diagnostics v_orphans = row_count;
  v_removidos := v_removidos + coalesce(v_orphans, 0);

  perform set_config('app.otb_reconciling', 'off', true);
  update colecoes set status = 'confirmada' where id = _colecao_id and tenant_id = v_tenant;
  return jsonb_build_object('criados', v_criados, 'removidos', v_removidos, 'mantidos', v_mantidos);
end;
$function$;

select pg_notify('pgrst', 'reload schema');
