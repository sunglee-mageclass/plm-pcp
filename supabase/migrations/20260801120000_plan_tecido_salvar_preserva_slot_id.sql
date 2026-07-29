-- Plan. Tecido [CRÍTICO]: o save PRESERVA o id do slot (não regenera).
--
-- Antes, _salvar_plan_tecido_core fazia delete+reinsert e REGENERAVA todos os ids de slot. Com o
-- re-merge desligado após salvar (fix do "não salvo"), o slot.id em memória ficava defasado do banco
-- → aplicar_ao_modelo e set_slot_oc recebiam id inexistente → "Sem permissão" / "Slot de outra loja",
-- e a OC de slot de planejamento sumia. Agora o front manda um id (client uuid, estável desde a
-- criação) e o INSERT usa esse id (coalesce com gen_random_uuid p/ compatibilidade). O slot_oc é
-- capturado de TODOS os slots (não só de modelo) e re-ligado pelos ids preservados.

BEGIN;

CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan uuid;
  v_sub jsonb; v_ln jsonb; v_slot jsonb; v_mat jsonb; v_var jsonb;
  v_sub_id uuid; v_ln_id uuid; v_slot_id uuid; v_mat_id uuid;
  v_slot_oc jsonb;
begin
  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;

  -- captura a OC-por-SLOT de TODOS os slots ANTES do delete (o slot_oc cascateia no delete)
  select coalesce(jsonb_agg(distinct jsonb_build_object('s', so.slot_id, 'o', so.oc_tecido_id)), '[]'::jsonb)
    into v_slot_oc
  from plan_tecido_slot_oc so
  join plan_tecido_slots sl on sl.id = so.slot_id
  join plan_tecido_linhas l on l.id = sl.linha_ref_id
  join plan_tecido_subcolecoes s on s.id = l.sub_id
  where s.plan_id = v_plan;

  delete from plan_tecido_subcolecoes where plan_id = v_plan;  -- cascateia subcolecao_categorias + slot_oc
  for v_sub in select * from jsonb_array_elements(coalesce(_arvore->'subcolecoes','[]'::jsonb)) loop
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, nullif(v_sub->>'subcolecao_id','')::uuid, coalesce((v_sub->>'ordem')::int,0))
      returning id into v_sub_id;
    insert into plan_tecido_subcolecao_categorias (subcolecao_id, categoria_id, ordem)
      select v_sub_id, nullif(t.val,'')::uuid, t.ord
      from jsonb_array_elements_text(coalesce(v_sub->'categorias_tecido','[]'::jsonb)) with ordinality as t(val, ord)
      where nullif(t.val,'') is not null
      on conflict (subcolecao_id, categoria_id) do nothing;
    for v_ln in select * from jsonb_array_elements(coalesce(v_sub->'linhas','[]'::jsonb)) loop
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
        values (v_sub_id, nullif(v_ln->>'linha_id','')::uuid, nullif(v_ln->>'categoria_id','')::uuid, coalesce((v_ln->>'ordem')::int,0))
        returning id into v_ln_id;
      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop
        insert into plan_tecido_slots (id, linha_ref_id, modelo_id, slot_index, nome, custo_simulado,
          custo_terceirizados_previsto, custos_adicionais, preco_venda, categoria_id, usar_estoque, proporcoes,
          categoria_tecido_id)
          values (coalesce(nullif(v_slot->>'id','')::uuid, gen_random_uuid()),  -- PRESERVA o id do slot
            v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
            v_slot->>'nome', v_slot->'custo_simulado',
            nullif(v_slot->>'custo_terceirizados_previsto','')::numeric,
            coalesce(v_slot->'custos_adicionais','[]'::jsonb),
            nullif(v_slot->>'preco_venda','')::numeric,
            nullif(v_slot->>'categoria_id','')::uuid,
            coalesce((v_slot->>'usar_estoque')::boolean, false),
            v_slot->'proporcoes',
            nullif(v_slot->>'categoria_tecido_id','')::uuid)
          returning id into v_slot_id;
        for v_mat in select * from jsonb_array_elements(coalesce(v_slot->'materiais','[]'::jsonb)) loop
          insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
            values (v_slot_id, nullif(v_mat->>'artigo_id','')::uuid, coalesce(v_mat->>'tipo','tecido'),
              coalesce((v_mat->>'numero')::int,1), coalesce((v_mat->>'consumo')::numeric,0),
              coalesce((v_mat->>'loss_percent')::numeric,0), coalesce((v_mat->>'ordem')::int,0))
            returning id into v_mat_id;
          for v_var in select * from jsonb_array_elements(coalesce(v_mat->'variantes','[]'::jsonb)) loop
            insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)
              values (v_mat_id, nullif(v_var->>'variante_tecido_id','')::uuid,
                nullif(v_var->>'cor_id','')::uuid, nullif(v_var->>'cor_apelido_id','')::uuid,
                coalesce((v_var->>'ordem')::int,1),
                coalesce((v_var->>'multiplicador')::numeric,1), coalesce(v_var->'grades','{}'::jsonb),
                coalesce((v_var->>'grade_total')::int,0));
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;

  -- re-liga o slot_oc pelos ids PRESERVADOS (slots que continuam existindo)
  if jsonb_array_length(v_slot_oc) > 0 then
    insert into plan_tecido_slot_oc (colecao_id, slot_id, oc_tecido_id)
      select _colecao_id, (e->>'s')::uuid, (e->>'o')::uuid
      from jsonb_array_elements(v_slot_oc) e
      join plan_tecido_slots sl on sl.id = (e->>'s')::uuid
      join plan_tecido_linhas l on l.id = sl.linha_ref_id
      join plan_tecido_subcolecoes s on s.id = l.sub_id
      where s.plan_id = v_plan
      on conflict (slot_id, oc_tecido_id) do nothing;
  end if;

  return v_plan;
end $function$;

COMMIT;
