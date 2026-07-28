-- Plan. Tecido — Fase 4.2: cor PLANEJADA (base + apelido) mesmo sem variante real.
--
-- Hoje uma variante do plano é sempre um variante_tecido_id real. O card precisa poder planejar uma
-- COR (cor base + cor apelido) antes do tecido ter fornecedor/variantes — e, quando o tecido ganhar a
-- variante correspondente, a cor planejada "vira" variante. Para isso, plan_tecido_variantes ganha
-- cor_id + cor_apelido_id (nullable): quando variante_tecido_id é null, a cor vem desses campos.
--
-- Cor só-planejada (sem variante_tecido_id) é DISPLAY/planejamento: não entra em pedido nem estoque
-- (a prévia/estoque filtram variante_tecido_id not null) — coerente: não dá pra comprar uma cor que
-- ainda não é variante. Divergência (cor planejada que não existe nas variantes do tecido) é detectada
-- no front. Save é wholesale (delete+reinsert), então basta persistir/retornar os novos campos.

BEGIN;

ALTER TABLE plan_tecido_variantes ADD COLUMN IF NOT EXISTS cor_id uuid REFERENCES cores(id) ON DELETE SET NULL;
ALTER TABLE plan_tecido_variantes ADD COLUMN IF NOT EXISTS cor_apelido_id uuid REFERENCES cores_apelido(id) ON DELETE SET NULL;

-- salvar: persiste cor_id/cor_apelido_id da variante planejada
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
begin
  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;
  delete from plan_tecido_subcolecoes where plan_id = v_plan;  -- cascateia p/ subcolecao_categorias
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
        insert into plan_tecido_slots (linha_ref_id, modelo_id, slot_index, nome, custo_simulado,
          custo_terceirizados_previsto, custos_adicionais, preco_venda, categoria_id, usar_estoque, proporcoes,
          categoria_tecido_id)
          values (v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
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
  return v_plan;
end $function$;

-- arvore: devolve cor_id/cor_apelido_id; label/cor_nome caem na cor PLANEJADA quando não há variante real
CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p.id is null then null else jsonb_build_object(
    'plan_id', p.id, 'colecao_id', p.colecao_id,
    'subcolecoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'subcolecao_id', s.subcolecao_id, 'ordem', s.ordem,
        'categorias_tecido', coalesce((select jsonb_agg(sc.categoria_id order by sc.ordem, sc.created_at)
          from plan_tecido_subcolecao_categorias sc where sc.subcolecao_id = s.id), '[]'::jsonb),
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
            'slots', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sl.id, 'modelo_id', sl.modelo_id, 'ref', m.ref, 'nome', coalesce(m.nome, sl.nome),
                'thumb_path', coalesce((m.fotos_modelo)[1], m.desenho_tecnico_url, m.croqui_url),
                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id,
                'usar_estoque', sl.usar_estoque,
                'proporcoes', coalesce(sl.proporcoes, m.proporcoes),
                'custo_simulado', sl.custo_simulado,
                'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
                'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
                'materiais', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', mt.id, 'artigo_id', mt.artigo_id, 'artigo_nome', a.nome,
                    'unidade_medida', a.unidade_medida, 'rendimento', a.rendimento,
                    'preco_por_metro', a.preco_por_metro,
                    'tipo', mt.tipo, 'numero', mt.numero, 'consumo', mt.consumo,
                    'loss_percent', mt.loss_percent, 'ordem', mt.ordem,
                    'variantes', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'id', vv.id, 'variante_tecido_id', vv.variante_tecido_id,
                        'cor_id', vv.cor_id, 'cor_apelido_id', vv.cor_apelido_id,
                        'label', concat_ws(' - ', vt.nome_variante, coalesce(cor.nome, pcor.nome), coalesce(ap.nome, pap.nome)),
                        'cor_nome', coalesce(cor.nome, pcor.nome),
                        'ordem', vv.ordem, 'multiplicador', vv.multiplicador,
                        'grades', vv.grades, 'grade_total', vv.grade_total) order by vv.ordem)
                      from plan_tecido_variantes vv
                      left join variantes_tecido vt on vt.id = vv.variante_tecido_id
                      left join cores cor on cor.id = vt.cor_id
                      left join cores_apelido ap on ap.id = vt.cor_apelido_id
                      left join cores pcor on pcor.id = vv.cor_id
                      left join cores_apelido pap on pap.id = vv.cor_apelido_id
                      where vv.material_id = mt.id), '[]'::jsonb)) order by mt.ordem)
                  from plan_tecido_materiais mt
                  left join artigos a on a.id = mt.artigo_id
                  where mt.slot_id = sl.id), '[]'::jsonb)) order by sl.slot_index)
              from plan_tecido_slots sl
              left join modelos m on m.id = sl.modelo_id
              where sl.linha_ref_id = l.id), '[]'::jsonb)) order by l.ordem)
          from plan_tecido_linhas l where l.sub_id = s.id), '[]'::jsonb)) order by s.ordem)
      from plan_tecido_subcolecoes s where s.plan_id = p.id), '[]'::jsonb)
  ) end
  from (select id, colecao_id from plan_tecido where colecao_id = _colecao_id) p;
$function$;

COMMIT;
