-- otb_confirmar passa a reconciliar por BUCKET = (subcoleção × semana × categoria):
-- se a semana tem distribuição por categoria (colecao_semana_categorias), gera 1 bucket
-- por categoria (qtd da categoria); senão, 1 bucket sem categoria (qtd da semana). O card
-- gerado já recebe a categoria. Predicado de "vazio" ajustado: categoria/coleção/subcoleção/
-- semana são preenchidos pelo OTB e NÃO contam como "tocado"; só remove card em
-- Planejamento/Rejeitado sem nada que o usuário tenha adicionado. Trava o trigger de baixa
-- (app.otb_reconciling) durante o encolher.
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
  v_existing int; v_diff int; v_removable uuid[];
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

  perform set_config('app.otb_reconciling', 'off', true);
  update colecoes set status = 'confirmada' where id = _colecao_id and tenant_id = v_tenant;
  return jsonb_build_object('criados', v_criados, 'removidos', v_removidos, 'mantidos', v_mantidos);
end;
$function$;

-- Excluir coleção também trava o trigger de baixa (os modelos apagados não devem
-- decrementar semanas que já vão sumir junto com a coleção).
CREATE OR REPLACE FUNCTION public.otb_excluir_colecao(_colecao_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_planejados int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  perform 1 from colecoes where id = _colecao_id and tenant_id = v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;

  select count(*) into v_planejados from modelos
    where tenant_id = v_tenant and colecao_id = _colecao_id and status_planejamento = 'planejado';
  if v_planejados > 0 then
    raise exception 'Não é possível excluir: % modelo(s) desta coleção já está(ão) em status planejado. Remova/reprove antes.', v_planejados;
  end if;

  perform set_config('app.otb_reconciling', 'on', true);
  delete from modelos where tenant_id = v_tenant and colecao_id = _colecao_id;
  delete from colecoes where id = _colecao_id and tenant_id = v_tenant;
end;
$function$;

select pg_notify('pgrst', 'reload schema');
