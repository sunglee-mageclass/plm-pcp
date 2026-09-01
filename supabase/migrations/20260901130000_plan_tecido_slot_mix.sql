-- Plan. Tecido persiste slot.mix_id no round-trip da árvore (decisão 9 do Agrupamento por Mix).
-- A VAGA vazia (slot sem modelo) que foi pré-atribuída a um mix precisa que o mix sobreviva ao
-- save da árvore. Cirúrgico: adiciona a coluna mix_id ao INSERT em plan_tecido_slots do
-- _salvar_plan_tecido_core (lida de v_slot->>'mix_id'), entre categoria_tecido_id e
-- referencia_paths. Todo o resto = pg_get_functiondef da versão viva, byte-a-byte.

begin;

CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb, _rev_base integer DEFAULT NULL::integer)
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
  -- [NOVO] guarda de tenant incondicional (não depende de _rev_base) — fecha o IDOR
  -- de escrita cross-tenant: antes disso, o filtro de tenant só existia dentro do
  -- bloco da trava otimista, que não roda quando _rev_base é null.
  if not exists (
    select 1 from public.colecoes c
    where c.id = _colecao_id
      and (c.tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'Coleção não encontrada ou sem permissão.';
  end if;

  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select plan_rev into v_rev from public.colecoes
        where id = _colecao_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;

  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR da árvore (antes de qualquer delete/reinsert).
  perform public._plan_tecido_snapshot(v_plan);

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
          categoria_tecido_id, mix_id, referencia_paths)
          values (coalesce(nullif(v_slot->>'id','')::uuid, gen_random_uuid()),  -- PRESERVA o id do slot
            v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
            v_slot->>'nome', v_slot->'custo_simulado',
            nullif(v_slot->>'custo_terceirizados_previsto','')::numeric,
            coalesce(v_slot->'custos_adicionais','[]'::jsonb),
            nullif(v_slot->>'preco_venda','')::numeric,
            nullif(v_slot->>'categoria_id','')::uuid,
            coalesce((v_slot->>'usar_estoque')::boolean, false),
            v_slot->'proporcoes',
            nullif(v_slot->>'categoria_tecido_id','')::uuid,
            nullif(v_slot->>'mix_id','')::uuid,
            coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(v_slot->'referencia_paths','[]'::jsonb)) t(x)), '{}'))
          returning id into v_slot_id;
        for v_mat in select * from jsonb_array_elements(coalesce(v_slot->'materiais','[]'::jsonb)) loop
          insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
            values (v_slot_id, nullif(v_mat->>'artigo_id','')::uuid, coalesce(v_mat->>'tipo','tecido'),
              coalesce((v_mat->>'numero')::int,1), coalesce((v_mat->>'consumo')::numeric,0),
              coalesce((v_mat->>'loss_percent')::numeric,0), coalesce((v_mat->>'ordem')::int,0))
            returning id into v_mat_id;
          -- [DEDUP] variante repetida (mesma cor real, ou mesma cor planejada) só entra 1× por
          -- material — mantém a de MAIOR grade_total (empate → menor ordem/posição original);
          -- linha sem identidade (variante e cor nulos) nunca colapsa. NUNCA soma. Ordem 1..n.
          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total)
          select v_mat_id, w.variante_tecido_id, w.cor_id, w.cor_apelido_id,
                 (row_number() over (order by w.ord_min, w.pos_min))::int,
                 w.multiplicador, w.grades, w.grade_total
          from (
            select r.*,
                   row_number() over (partition by r.dkey order by r.grade_total desc, r.ord_orig asc, r.pos asc) as rn,
                   min(r.ord_orig) over (partition by r.dkey) as ord_min,
                   min(r.pos)      over (partition by r.dkey) as pos_min
            from (
              select
                nullif(e->>'variante_tecido_id','')::uuid  as variante_tecido_id,
                nullif(e->>'cor_id','')::uuid              as cor_id,
                nullif(e->>'cor_apelido_id','')::uuid      as cor_apelido_id,
                coalesce((e->>'multiplicador')::numeric,1) as multiplicador,
                coalesce(e->'grades','{}'::jsonb)          as grades,
                coalesce((e->>'grade_total')::int,0)       as grade_total,
                coalesce((e->>'ordem')::int, pos::int)     as ord_orig,
                pos,
                case
                  when nullif(e->>'variante_tecido_id','') is not null
                    then 'v:'||(e->>'variante_tecido_id')
                  when nullif(e->>'cor_id','') is not null or nullif(e->>'cor_apelido_id','') is not null
                    then 'p:'||coalesce(e->>'cor_id','')||'|'||coalesce(e->>'cor_apelido_id','')
                  else 'n:'||pos::text
                end as dkey
              from jsonb_array_elements(coalesce(v_mat->'variantes','[]'::jsonb)) with ordinality as t(e, pos)
            ) r
          ) w
          where w.rn = 1;
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

  -- bump da árvore do Plan. Tecido: NÃO precisa de update manual aqui. O insert/upsert em
  -- plan_tecido (topo desta função) já dispara trg_colab_bump (Task 1) → fn_colab_bump_plan()
  -- → UPDATE no-op em colecoes → trg_colab_plan_rev incrementa plan_rev em exatamente 1.
  -- (Um update explícito aqui SOMARIA um 2º bump — foi removido no fix round da revisão.)

  return v_plan;
end $function$

;

commit;

select pg_notify('pgrst', 'reload schema');
