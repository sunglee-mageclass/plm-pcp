-- 20260725100100_plan_tecido_rpcs.sql — Plan. Tecido RPC de escrita (Fase A.1)
begin;

create or replace function public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_plan uuid;
  v_sub jsonb; v_ln jsonb; v_slot jsonb; v_mat jsonb; v_var jsonb;
  v_sub_id uuid; v_ln_id uuid; v_slot_id uuid; v_mat_id uuid;
begin
  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;
  -- delete-then-insert das subcoleções (cascata limpa o resto)
  delete from plan_tecido_subcolecoes where plan_id = v_plan;
  for v_sub in select * from jsonb_array_elements(coalesce(_arvore->'subcolecoes','[]'::jsonb)) loop
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, nullif(v_sub->>'subcolecao_id','')::uuid, coalesce((v_sub->>'ordem')::int,0))
      returning id into v_sub_id;
    for v_ln in select * from jsonb_array_elements(coalesce(v_sub->'linhas','[]'::jsonb)) loop
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
        values (v_sub_id, nullif(v_ln->>'linha_id','')::uuid, nullif(v_ln->>'categoria_id','')::uuid, coalesce((v_ln->>'ordem')::int,0))
        returning id into v_ln_id;
      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop
        insert into plan_tecido_slots (linha_ref_id, modelo_id, slot_index, nome, custo_simulado,
          custo_terceirizados_previsto, custos_adicionais, preco_venda)
          values (v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
            v_slot->>'nome', v_slot->'custo_simulado',
            nullif(v_slot->>'custo_terceirizados_previsto','')::numeric,
            coalesce(v_slot->'custos_adicionais','[]'::jsonb),
            nullif(v_slot->>'preco_venda','')::numeric)
          returning id into v_slot_id;
        for v_mat in select * from jsonb_array_elements(coalesce(v_slot->'materiais','[]'::jsonb)) loop
          insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
            values (v_slot_id, nullif(v_mat->>'artigo_id','')::uuid, coalesce(v_mat->>'tipo','tecido'),
              coalesce((v_mat->>'numero')::int,1), coalesce((v_mat->>'consumo')::numeric,0),
              coalesce((v_mat->>'loss_percent')::numeric,0), coalesce((v_mat->>'ordem')::int,0))
            returning id into v_mat_id;
          for v_var in select * from jsonb_array_elements(coalesce(v_mat->'variantes','[]'::jsonb)) loop
            insert into plan_tecido_variantes (material_id, variante_tecido_id, ordem, multiplicador, grades, grade_total)
              values (v_mat_id, nullif(v_var->>'variante_tecido_id','')::uuid, coalesce((v_var->>'ordem')::int,1),
                coalesce((v_var->>'multiplicador')::numeric,1), coalesce(v_var->'grades','{}'::jsonb),
                coalesce((v_var->>'grade_total')::int,0));
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  return v_plan;
end $$;

create or replace function public.salvar_plan_tecido(_colecao_id uuid, _arvore jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criacao não habilitado para esta loja' using errcode='42501';
  end if;
  return public._salvar_plan_tecido_core(_colecao_id, _arvore);
end $$;

revoke execute on function public._salvar_plan_tecido_core(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.salvar_plan_tecido(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
