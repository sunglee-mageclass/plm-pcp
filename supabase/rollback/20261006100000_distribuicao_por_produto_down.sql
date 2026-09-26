-- INVERSO da Distribuição por produto (aditiva 20261006100000) — GERADO por gerar_sql.py (NÃO editar à mão).
-- DESTRUTIVO: o DROP COLUMN apaga a distribuição e o "atende a" digitados (o script da volta EXPORTA antes).
-- LIFO (R37): a remoção da Distribuição antiga (20261006110000) precisa ter voltado ANTES (o front revertido usa a
-- tabela e as RPCs antigas). Exige SET LOCAL app.confirmo_apagar_distribuicao_por_produto = 'sim'.
-- Aplicar SÓ via .superpowers/distribuicao/mig/volta-producao.sh (produção) ou copia.sh volta (cópia). PR10: encoding ANTES
-- do BEGIN; trava explícita em plan_tecido_variantes ANTES da guarda; pós-condição (bloco DO no fim) e NOTIFY antes do COMMIT.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';
LOCK TABLE public.plan_tecido_variantes IN ACCESS EXCLUSIVE MODE;

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF coalesce(current_setting('app.confirmo_apagar_distribuicao_por_produto', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): o DROP COLUMN apaga a distribuição e o atende a digitados — rode com SET LOCAL app.confirmo_apagar_distribuicao_por_produto = ''sim'' (o script da volta exporta antes)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.distribuicao_tabelas') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): a Distribuição antiga foi removida — volte PRIMEIRO a remoção (20261006110000) — LIFO' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_plan_tecido_core(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _salvar_plan_tecido_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._salvar_plan_tecido_core(uuid,jsonb,integer)'::regprocedure));
  IF v_md5 NOT IN ('ddadff5e77d6d266a674d62ec7cf04ba', '58fcaddadee3c7ab8cac44c0597c9368') THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _salvar_plan_tecido_core mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_gravar_bom_core(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _plan_tecido_gravar_bom_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_gravar_bom_core(uuid,jsonb)'::regprocedure));
  IF v_md5 NOT IN ('3cc5d45c9bbba09524ff2d92af205924', 'e13300caf9241a4ad9e0f36e5e26528b') THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _plan_tecido_gravar_bom_core mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_snapshot(uuid)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _plan_tecido_snapshot não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_snapshot(uuid)'::regprocedure));
  IF v_md5 NOT IN ('c9492de31f03d9ccc86000162b7e55b4', '75d43c800b38b08c77831a645dcb4b3d') THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _plan_tecido_snapshot mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.tenant_module_enabled(text)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): tenant_module_enabled não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public.tenant_module_enabled(text)'::regprocedure));
  IF v_md5 NOT IN ('0b87d95bc0c479c82f69faf7136a1983', '843163ccc128c53753ed08d3e4041cb3') THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): tenant_module_enabled mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_arvore_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _plan_tecido_arvore_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_arvore_core(uuid)'::regprocedure));
  IF v_md5 NOT IN ('d8685568697b86aacf830ad3b70bd934', '137774116f4ec7fad102b6754a6decf3') THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): _plan_tecido_arvore_core mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- a árvore volta PRIMEIRO (deixa de ler as colunas que vão sair)
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
                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id, 'mix_id', case when sl.modelo_id is not null then m.mix_id else sl.mix_id end,
                'usar_estoque', sl.usar_estoque,
                'proporcoes', coalesce(sl.proporcoes, m.proporcoes),
                'custo_simulado', sl.custo_simulado,
                'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
                'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
                'referencia_paths', to_jsonb(coalesce(sl.referencia_paths,'{}'::text[])),
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
                        'variante_artigo_id', vt.artigo_id,
                        'cor_id', vv.cor_id, 'cor_apelido_id', vv.cor_apelido_id,
                        'label', concat_ws(' - ', coalesce(cor.nome, pcor.nome), coalesce(ap.nome, pap.nome)),
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
end $function$;

CREATE OR REPLACE FUNCTION public._plan_tecido_gravar_bom_core(_modelo uuid, _materiais jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;
begin
  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR do BOM (no-op se o modelo ainda não tem BOM — Criar card)
  perform public._modelo_bom_snapshot(_modelo, 'aplicar');

  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada
  delete from modelo_tecido_variantes where modelo_tecido_id in (
    select id from modelo_tecidos where modelo_id = _modelo and tipo in ('tecido','forro'));
  delete from modelo_tecidos where modelo_id = _modelo and tipo in ('tecido','forro');
  delete from modelo_grades where modelo_id = _modelo;

  for m in select * from jsonb_array_elements(coalesce(_materiais, '[]'::jsonb)) loop
    if nullif(m->>'artigo_id','') is null then continue; end if;
    v_num := coalesce((m->>'numero')::int, 1);
    v_tipo := coalesce(nullif(m->>'tipo',''), 'tecido');
    if v_tipo not in ('tecido','forro') then continue; end if;
    insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent)
    values (_modelo, (m->>'artigo_id')::uuid, v_num, v_tipo,
            coalesce((m->>'consumo')::numeric, 0), coalesce((m->>'loss_percent')::numeric, 0))
    returning id into v_mt;
    for v in select * from jsonb_array_elements(coalesce(m->'variantes', '[]'::jsonb)) loop
      if nullif(v->>'variante_tecido_id','') is null then continue; end if;
      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)
      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),
              coalesce((v->>'multiplicador')::numeric, 1));
      if v_tipo = 'tecido' and v_num = 1 then
        insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
        values (_modelo, coalesce((v->>'ordem')::int, 1),
                coalesce(v->'grades', '{}'::jsonb), coalesce((v->>'grade_total')::int, 0));
      end if;
    end loop;
  end loop;

  -- snapshot do Planejamento (tecidos_planejados) sempre consistente com o BOM real
  update modelos set tecidos_planejados = coalesce((
    select array_agg(distinct artigo_id) from modelo_tecidos
    where modelo_id = _modelo and tipo = 'tecido' and artigo_id is not null), '{}'::uuid[])
  where id = _modelo;
end $function$;

CREATE OR REPLACE FUNCTION public._plan_tecido_snapshot(_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_col uuid; v_tenant uuid;
  v_arvore jsonb; v_slot_oc jsonb;
begin
  if not exists (select 1 from plan_tecido_subcolecoes where plan_id = _plan_id) then
    return;  -- nada a snapshotar (plano novo / vazio)
  end if;

  select pt.colecao_id, c.tenant_id into v_col, v_tenant
  from plan_tecido pt join colecoes c on c.id = pt.colecao_id
  where pt.id = _plan_id;
  if v_tenant is null then return; end if;

  select jsonb_build_object('subcolecoes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'subcolecao_id', s.subcolecao_id,
      'ordem', s.ordem,
      'categorias_tecido', coalesce((
        select jsonb_agg(sc.categoria_id order by sc.ordem)
        from plan_tecido_subcolecao_categorias sc where sc.subcolecao_id = s.id), '[]'::jsonb),
      'linhas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
          'slots', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', sl.id, 'modelo_id', sl.modelo_id, 'slot_index', sl.slot_index,
              'nome', sl.nome, 'custo_simulado', sl.custo_simulado,
              'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
              'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
              'categoria_id', sl.categoria_id, 'usar_estoque', sl.usar_estoque,
              'proporcoes', sl.proporcoes, 'categoria_tecido_id', sl.categoria_tecido_id,
              'materiais', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'artigo_id', pm.artigo_id, 'tipo', pm.tipo, 'numero', pm.numero,
                  'consumo', pm.consumo, 'loss_percent', pm.loss_percent, 'ordem', pm.ordem,
                  'variantes', coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'variante_tecido_id', pv.variante_tecido_id, 'cor_id', pv.cor_id,
                      'cor_apelido_id', pv.cor_apelido_id, 'ordem', pv.ordem,
                      'multiplicador', pv.multiplicador, 'grades', pv.grades,
                      'grade_total', pv.grade_total
                    ) order by pv.ordem)
                    from plan_tecido_variantes pv where pv.material_id = pm.id), '[]'::jsonb)
                ) order by pm.ordem)
                from plan_tecido_materiais pm where pm.slot_id = sl.id), '[]'::jsonb)
            ) order by sl.slot_index)
            from plan_tecido_slots sl where sl.linha_ref_id = l.id), '[]'::jsonb)
        ) order by l.ordem)
        from plan_tecido_linhas l where l.sub_id = s.id), '[]'::jsonb)
    ) order by s.ordem)
    from plan_tecido_subcolecoes s where s.plan_id = _plan_id), '[]'::jsonb))
  into v_arvore;

  select coalesce(jsonb_agg(jsonb_build_object('slot_id', so.slot_id, 'oc_tecido_id', so.oc_tecido_id)), '[]'::jsonb)
  into v_slot_oc
  from plan_tecido_slot_oc so
  join plan_tecido_slots sl on sl.id = so.slot_id
  join plan_tecido_linhas l on l.id = sl.linha_ref_id
  join plan_tecido_subcolecoes s on s.id = l.sub_id
  where s.plan_id = _plan_id;

  insert into plan_tecido_snapshots (tenant_id, plan_id, colecao_id, payload, user_id)
  values (v_tenant, _plan_id, v_col,
    jsonb_build_object('colecao_id', v_col, 'plan_id', _plan_id, 'arvore', v_arvore, 'slot_oc', v_slot_oc),
    auth.uid());

  -- retenção: 20 últimos por plan + apaga >60 dias
  delete from plan_tecido_snapshots ps
  where ps.plan_id = _plan_id
    and ps.id not in (
      select id from plan_tecido_snapshots where plan_id = _plan_id
      order by created_at desc, id desc limit 20);
  delete from plan_tecido_snapshots where plan_id = _plan_id and created_at < now() - interval '60 days';
end $function$;

CREATE OR REPLACE FUNCTION public.tenant_module_enabled(_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha
  -- `useTenantModules.DEFAULTS`/`admin/lojas.tsx MODULE_DEFAULTS` no front. Módulos "clássicos"
  -- (criacao, entrada_saida, producao, financeiro, cadastro, dashboard) ficam de fora de
  -- propósito: chave ausente = ON pra eles (loja sem tenant_config não perde os módulos-núcleo).
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    _module NOT IN ('otb', 'produto_acabado', 'produto_importado')
  );
$function$;

DROP FUNCTION IF EXISTS public.direcionamento_plano_modelo(uuid);
DROP FUNCTION IF EXISTS public._direcionamento_plano_modelo_core(uuid, uuid);
REVOKE EXECUTE ON FUNCTION public._salvar_plan_tecido_core(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_gravar_bom_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_arvore_core(uuid) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.plan_tecido_variantes
  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_atende_array,
  DROP CONSTRAINT IF EXISTS plan_tecido_variantes_distribuicao_objeto,
  DROP COLUMN IF EXISTS atende,
  DROP COLUMN IF EXISTS distribuicao;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_plan_tecido_core(uuid,jsonb,integer)')));
  IF v_md5 IS DISTINCT FROM 'ddadff5e77d6d266a674d62ec7cf04ba' THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): pós-condição falhou — _salvar_plan_tecido_core não voltou ao texto de antes (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_gravar_bom_core(uuid,jsonb)')));
  IF v_md5 IS DISTINCT FROM '3cc5d45c9bbba09524ff2d92af205924' THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): pós-condição falhou — _plan_tecido_gravar_bom_core não voltou ao texto de antes (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_snapshot(uuid)')));
  IF v_md5 IS DISTINCT FROM 'c9492de31f03d9ccc86000162b7e55b4' THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): pós-condição falhou — _plan_tecido_snapshot não voltou ao texto de antes (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.tenant_module_enabled(text)')));
  IF v_md5 IS DISTINCT FROM '0b87d95bc0c479c82f69faf7136a1983' THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): pós-condição falhou — tenant_module_enabled não voltou ao texto de antes (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_arvore_core(uuid)')));
  IF v_md5 IS DISTINCT FROM 'd8685568697b86aacf830ad3b70bd934' THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): pós-condição falhou — _plan_tecido_arvore_core não voltou ao texto de antes (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.direcionamento_plano_modelo(uuid)') IS NOT NULL
     OR to_regprocedure('public._direcionamento_plano_modelo_core(uuid,uuid)') IS NOT NULL
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'plan_tecido_variantes'
           AND column_name IN ('distribuicao', 'atende')) <> 0 THEN
    RAISE EXCEPTION 'distribuicao_produto (volta): pós-condição falhou — RPCs novas/colunas ainda presentes — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
