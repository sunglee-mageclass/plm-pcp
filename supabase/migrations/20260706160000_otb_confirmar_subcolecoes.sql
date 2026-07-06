-- otb_confirmar passa a reconciliar os cards em branco por (SUBCOLEÇÃO × semana):
-- cada semana de colecao_semanas pertence a uma subcoleção (sc.nome) ou à coleção
-- (subcolecao_id NULL = modo simples). O modelo gerado já recebe a subcoleção.
CREATE OR REPLACE FUNCTION public.otb_confirmar(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_col record;
  v_wk record;
  v_criados int := 0; v_removidos int := 0; v_mantidos int := 0;
  v_existing int; v_diff int; v_removable uuid[];
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  select * into v_col from colecoes where id = _colecao_id and tenant_id = v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;

  for v_wk in
    select cs.semana, cs.qtd_planejada, sc.nome as subcol
    from colecao_semanas cs
    left join colecao_subcolecoes sc on sc.id = cs.subcolecao_id
    where cs.colecao_id = _colecao_id and cs.tenant_id = v_tenant
  loop
    select count(*) into v_existing from modelos
      where tenant_id = v_tenant and colecao_id = _colecao_id
        and coalesce(semana,'') = v_wk.semana
        and coalesce(subcolecao,'') = coalesce(v_wk.subcol,'');
    v_diff := v_wk.qtd_planejada - v_existing;

    if v_diff > 0 then
      insert into modelos (tenant_id, colecao_id, colecao, subcolecao, semana, mes_id, ano_id, status_planejamento, versao,
                           nome, tecidos_planejados, fotos_modelo, fotos_referencia, observacoes_gerais)
      select v_tenant, _colecao_id, v_col.nome, v_wk.subcol, v_wk.semana, v_col.mes_id, v_col.ano_id, 'em_planejamento', 1,
             '', '{}'::uuid[], '{}'::text[], '{}'::text[], ''
      from generate_series(1, v_diff);
      v_criados := v_criados + v_diff;

    elsif v_diff < 0 then
      -- remove só os "não tocados" desta semana/subcoleção, até -v_diff
      select array_agg(id) into v_removable from (
        select id from modelos
        where tenant_id = v_tenant and colecao_id = _colecao_id
          and coalesce(semana,'') = v_wk.semana
          and coalesce(subcolecao,'') = coalesce(v_wk.subcol,'')
          and coalesce(nome,'') = '' and estilista_id is null and categoria_principal_id is null
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
      v_mantidos := v_mantidos + (v_existing - v_wk.qtd_planejada) - coalesce(array_length(v_removable,1),0);
    end if;
  end loop;

  update colecoes set status = 'confirmada' where id = _colecao_id and tenant_id = v_tenant;
  return jsonb_build_object('criados', v_criados, 'removidos', v_removidos, 'mantidos', v_mantidos);
end;
$function$;

select pg_notify('pgrst', 'reload schema');
