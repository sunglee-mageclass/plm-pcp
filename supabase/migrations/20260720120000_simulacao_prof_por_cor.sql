-- Profundidade por cor (override por modelo × cor) no Simulador de OC.
-- Persiste otb_simulacao_modelos.prof_por_cor (jsonb: ocItemId -> profundidade).
BEGIN;

ALTER TABLE public.otb_simulacao_modelos
  ADD COLUMN IF NOT EXISTS prof_por_cor jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.salvar_simulacao(_id uuid, _header jsonb, _arvore jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid := _id; v_colecao uuid; v_un jsonb; v_ln jsonb; v_md jsonb; v_var jsonb;
  v_un_id uuid; v_ln_id uuid; v_li int; v_mi int; v_vi int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  v_colecao := nullif(_header->>'colecao_id','')::uuid;
  if v_colecao is null then raise exception 'Informe a coleção.'; end if;
  if coalesce(btrim(_header->>'nome'),'') = '' then raise exception 'Informe o nome do cenário.'; end if;
  if not exists (select 1 from public.colecoes where id = v_colecao and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Coleção não encontrada.';
  end if;

  if v_id is null then
    insert into public.otb_simulacoes (colecao_id, nome) values (v_colecao, btrim(_header->>'nome')) returning id into v_id;
  else
    update public.otb_simulacoes set nome = btrim(_header->>'nome')
      where id = v_id and colecao_id = v_colecao and tenant_id = public.get_user_tenant_id();
    if not found then raise exception 'Cenário não encontrado.'; end if;
    delete from public.otb_simulacao_unidades where simulacao_id = v_id; -- cascata: variantes/linhas/modelos
  end if;

  for v_un in select value from jsonb_array_elements(coalesce(_arvore,'[]'::jsonb)) loop
    insert into public.otb_simulacao_unidades (simulacao_id, subcolecao_id, oc_tecido_id)
    values (v_id, nullif(v_un->>'subcolecao_id','')::uuid, nullif(v_un->>'oc_tecido_id','')::uuid)
    returning id into v_un_id;

    v_vi := 0;
    for v_var in select value from jsonb_array_elements(coalesce(v_un->'variantes','[]'::jsonb)) loop
      insert into public.otb_simulacao_variantes (unidade_id, oc_tecido_item_id, ordem)
      values (v_un_id, nullif(v_var->>'oc_tecido_item_id','')::uuid, v_vi);
      v_vi := v_vi + 1;
    end loop;

    v_li := 0;
    for v_ln in select value from jsonb_array_elements(coalesce(v_un->'linhas','[]'::jsonb)) loop
      insert into public.otb_simulacao_linhas (unidade_id, linha_id, prof_cor, cores, num_modelos, ordem)
      values (v_un_id, nullif(v_ln->>'linha_id','')::uuid,
              greatest(0, coalesce((v_ln->>'prof_cor')::int, 0)),
              greatest(0, coalesce((v_ln->>'cores')::int, 0)),
              greatest(0, coalesce((v_ln->>'num_modelos')::int, 0)), v_li)
      returning id into v_ln_id;
      v_li := v_li + 1;
      v_mi := 0;
      for v_md in select value from jsonb_array_elements(coalesce(v_ln->'modelos','[]'::jsonb)) loop
        insert into public.otb_simulacao_modelos (linha_ref_id, modelo_id, slot_index, consumo, prof_por_cor)
        values (v_ln_id, nullif(v_md->>'modelo_id','')::uuid,
                coalesce((v_md->>'slot_index')::int, v_mi),
                greatest(0, coalesce((v_md->>'consumo')::numeric, 0)),
                coalesce(v_md->'prof_por_cor', '{}'::jsonb));
        v_mi := v_mi + 1;
      end loop;
    end loop;
  end loop;
  return v_id;
end $function$;

COMMIT;
