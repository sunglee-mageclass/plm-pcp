-- OTB: otb_salvar_colecao passa a aplicar as ATRIBUIÇÕES de card feitas no editor (adiadas)
-- junto no Save (payload assignments = [{modelo_id, sub_nome|null, semana}]). GUC evita 2×.

CREATE OR REPLACE FUNCTION public.otb_salvar_colecao(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant   uuid    := public.get_user_tenant_id();
  v_id       uuid    := nullif(_payload->>'id','')::uuid;
  v_nome     text    := trim(coalesce(_payload->>'nome',''));
  v_subs     jsonb   := coalesce(_payload->'subs', '[]'::jsonb);
  v_has_subs boolean := jsonb_array_length(v_subs) > 0;
  v_kept     uuid[];
  v_sub      jsonb;
  v_sub_id   uuid;
  v_weeks    jsonb;
  v_cats     jsonb;
  v_meta     jsonb;
  v_i        int := 0;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_nome = '' then raise exception 'Informe o nome da coleção.'; end if;

  -- Upsert da coleção.
  if v_id is null then
    insert into colecoes (nome, ano_id, mes_id, orcamento)
    values (v_nome, nullif(_payload->>'ano_id','')::uuid, nullif(_payload->>'mes_id','')::uuid,
            nullif(_payload->>'orcamento','')::numeric)
    returning id into v_id;  -- set_tenant_id_trg preenche tenant_id
  else
    update colecoes set
      nome = v_nome,
      ano_id = nullif(_payload->>'ano_id','')::uuid,
      mes_id = nullif(_payload->>'mes_id','')::uuid,
      orcamento = nullif(_payload->>'orcamento','')::numeric
    where id = v_id and tenant_id = v_tenant;
    if not found then raise exception 'Coleção não encontrada'; end if;
  end if;

  -- Regrava do zero: apaga semanas + distribuição (todos os níveis) da coleção.
  delete from colecao_semana_categorias where colecao_id = v_id;
  delete from colecao_semanas where colecao_id = v_id;

  if v_has_subs then
    -- Remove subcoleções que sumiram (só as mantidas ficam).
    select coalesce(array_agg(nullif(s->>'id','')::uuid) filter (where nullif(s->>'id','') is not null), '{}'::uuid[])
      into v_kept from jsonb_array_elements(v_subs) s;
    delete from colecao_subcolecoes where colecao_id = v_id and not (id = any(v_kept));

    -- Insere/atualiza cada subcoleção (na ordem) + regrava suas semanas e distribuição.
    for v_sub in select value from jsonb_array_elements(v_subs) loop
      v_sub_id := nullif(v_sub->>'id','')::uuid;
      if v_sub_id is null then
        insert into colecao_subcolecoes (colecao_id, nome, ordem)
        values (v_id, v_sub->>'nome', v_i) returning id into v_sub_id;
      else
        update colecao_subcolecoes set nome = v_sub->>'nome', ordem = v_i
        where id = v_sub_id and colecao_id = v_id;
      end if;
      v_weeks := coalesce(v_sub->'weeks', '{}'::jsonb);
      v_cats  := coalesce(v_sub->'cats',  '{}'::jsonb);
      v_meta  := coalesce(v_sub->'meta',  '{}'::jsonb);
      insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada, texto, data)
        select v_id, v_sub_id, k, coalesce((v_weeks->>k)::int, 0),
               nullif(v_meta->k->>'texto',''), nullif(v_meta->k->>'data','')::date
        from jsonb_object_keys(v_weeks) k;
      insert into colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd)
        select v_id, v_sub_id, wk.key, cat.key::uuid, cat.value::int
        from jsonb_each(v_cats) wk, jsonb_each_text(wk.value) cat
        where (v_weeks ? wk.key) and cat.value::int > 0;
      v_i := v_i + 1;
    end loop;
  else
    -- Sem subcoleções: apaga todas (cascade) e grava no nível coleção.
    delete from colecao_subcolecoes where colecao_id = v_id;
    v_weeks := coalesce(_payload->'weeks',    '{}'::jsonb);
    v_cats  := coalesce(_payload->'weekCats', '{}'::jsonb);
    v_meta  := coalesce(_payload->'weeksMeta','{}'::jsonb);
    insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada, texto, data)
      select v_id, null, k, coalesce((v_weeks->>k)::int, 0),
             nullif(v_meta->k->>'texto',''), nullif(v_meta->k->>'data','')::date
      from jsonb_object_keys(v_weeks) k;
    insert into colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd)
      select v_id, null, wk.key, cat.key::uuid, cat.value::int
      from jsonb_each(v_cats) wk, jsonb_each_text(wk.value) cat
      where (v_weeks ? wk.key) and cat.value::int > 0;
  end if;

  -- Atribuições de cards feitas NO EDITOR (não-classificados), aplicadas junto no Save.
  -- A qtd do bucket já veio do payload (o editor somou +1 local ao atribuir), então a trava
  -- GUC desliga o gatilho fn_otb_sync_semana p/ o modelo só receber subcolecao/semana SEM
  -- re-incrementar (senão contava 2×). sub_nome null = nível coleção. Fechar sem salvar = descarta.
  if jsonb_array_length(coalesce(_payload->'assignments','[]'::jsonb)) > 0 then
    perform set_config('app.otb_reconciling', 'on', true);
    for v_sub in select value from jsonb_array_elements(_payload->'assignments') loop
      if nullif(v_sub->>'sub_nome','') is not null
         and not exists (select 1 from public.colecao_subcolecoes where colecao_id = v_id and nome = v_sub->>'sub_nome') then
        raise exception 'Subcoleção "%" não encontrada para atribuição', v_sub->>'sub_nome';
      end if;
      update public.modelos set subcolecao = nullif(v_sub->>'sub_nome',''), semana = v_sub->>'semana'
      where id = (v_sub->>'modelo_id')::uuid and colecao_id = v_id and tenant_id = v_tenant;
    end loop;
    perform set_config('app.otb_reconciling', 'off', true);
  end if;

  return v_id;
end $function$;

select pg_notify('pgrst','reload schema');
