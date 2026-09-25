-- Distribuição por produto — ADITIVA (spec docs/superpowers/specs/2026-09-25-distribuicao-por-produto-design.md §5.1;
-- plano docs/superpowers/plans/2026-09-25-distribuicao-por-produto.md, Task 4). GERADA por
-- .superpowers/distribuicao/mig/gerar_sql.py a partir do texto VIVO — NÃO editar à mão.
-- • plan_tecido_variantes: distribuicao (Tecido 1: {loja_id: {base, grades, manuais}}) e atende (demais blocos: chaves
--   de cor do Tecido 1; NULL = automático pela cor base) + 2 CHECKs de forma.
-- • 5 funções redefinidas por âncoras exatas (guarda md5 EXATA): salvar/árvore/blindagem do Plan. Tecido levam as 2
--   colunas; o gravar do BOM grava o casamento (complementa_variante_ids) e PRESERVA o que já havia quando o payload
--   não traz a chave; tenant_module_enabled passa a tratar 'distribuicao' como opt-in (ACL da função intocada).
-- • RPC nova direcionamento_plano_modelo (+ _core revogado dos 3): o plano SALVO por modelo p/ o Direcionamento.
-- • Contagem: +2 funções, +0 gatilhos. Nenhuma DDL de policy; nada em tenant_config. A árvore (LANGUAGE sql, valida
--   as colunas no CREATE) vem DEPOIS da coluna nova, no fim — a trava em plan_tecido_variantes dura ms.
-- Aplicar SÓ via .superpowers/distribuicao/mig/ida-producao.sh (produção) ou copia.sh / ensaio-local.sh (cópia): pré-voo,
-- backup e aplica_v2 (que reinjeta as travas — inofensivo). NÃO psql -f solto. PR10: `SET client_encoding = 'UTF8'` ANTES
-- do BEGIN (os textos têm acento); pós-condição (bloco DO no fim, md5 "depois" das 7 funções + colunas/CHECKs) e NOTIFY pgrst
-- ANTES do COMMIT — qualquer divergência desfaz tudo. Inverso: supabase/rollback/20261006100000_distribuicao_por_produto_down.sql.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public._salvar_plan_tecido_core(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto: _salvar_plan_tecido_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._salvar_plan_tecido_core(uuid,jsonb,integer)'::regprocedure));
  IF v_md5 NOT IN ('ddadff5e77d6d266a674d62ec7cf04ba', '58fcaddadee3c7ab8cac44c0597c9368') THEN
    RAISE EXCEPTION 'distribuicao_produto: _salvar_plan_tecido_core mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_gravar_bom_core(uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto: _plan_tecido_gravar_bom_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_gravar_bom_core(uuid,jsonb)'::regprocedure));
  IF v_md5 NOT IN ('3cc5d45c9bbba09524ff2d92af205924', 'e13300caf9241a4ad9e0f36e5e26528b') THEN
    RAISE EXCEPTION 'distribuicao_produto: _plan_tecido_gravar_bom_core mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_snapshot(uuid)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto: _plan_tecido_snapshot não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_snapshot(uuid)'::regprocedure));
  IF v_md5 NOT IN ('c9492de31f03d9ccc86000162b7e55b4', '75d43c800b38b08c77831a645dcb4b3d') THEN
    RAISE EXCEPTION 'distribuicao_produto: _plan_tecido_snapshot mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.tenant_module_enabled(text)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto: tenant_module_enabled não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public.tenant_module_enabled(text)'::regprocedure));
  IF v_md5 NOT IN ('0b87d95bc0c479c82f69faf7136a1983', '843163ccc128c53753ed08d3e4041cb3') THEN
    RAISE EXCEPTION 'distribuicao_produto: tenant_module_enabled mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_arvore_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'distribuicao_produto: _plan_tecido_arvore_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_arvore_core(uuid)'::regprocedure));
  IF v_md5 NOT IN ('d8685568697b86aacf830ad3b70bd934', '137774116f4ec7fad102b6754a6decf3') THEN
    RAISE EXCEPTION 'distribuicao_produto: _plan_tecido_arvore_core mudou desde o planejamento (md5 %) — outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._direcionamento_plano_modelo_core(uuid,uuid)') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public._direcionamento_plano_modelo_core(uuid,uuid)'))) <> 'f7d64d00d6219b56e2caec24252e3590' THEN -- nova
    RAISE EXCEPTION 'distribuicao_produto: _direcionamento_plano_modelo_core já existe com OUTRO texto — PARE' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.direcionamento_plano_modelo(uuid)') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.direcionamento_plano_modelo(uuid)'))) <> '734f015d27ccebbe4da028d6005a70e7' THEN -- nova
    RAISE EXCEPTION 'distribuicao_produto: direcionamento_plano_modelo já existe com OUTRO texto — PARE' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

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
          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total, distribuicao, atende)
          select v_mat_id, w.variante_tecido_id, w.cor_id, w.cor_apelido_id,
                 (row_number() over (order by w.ord_min, w.pos_min))::int,
                 w.multiplicador, w.grades, w.grade_total, w.distribuicao, w.atende
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
                -- Distribuição por produto (20261006100000): `distribuicao` SÓ no Tecido 1 e só objeto; `atende` SÓ fora
                -- do Tecido 1 e só array (o DEDUP leva as da linha vencedora).
                case when coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1 and jsonb_typeof(e->'distribuicao') = 'object'
                     then e->'distribuicao' else '{}'::jsonb end as distribuicao,
                case when not (coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1) and jsonb_typeof(e->'atende') = 'array'
                     then e->'atende' else null end as atende,
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
  v_comp_antes jsonb; v_t1_ids uuid[];
begin
  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR do BOM (no-op se o modelo ainda não tem BOM — Criar card)
  perform public._modelo_bom_snapshot(_modelo, 'aplicar');

  -- [Distribuição por produto, 20261006100000] "atende a" = casar variantes (R3): o casamento que o BOM já tinha
  -- (complementa_variante_ids) é guardado ANTES do delete — payload SEM a chave o PRESERVA (antes ele sumia em
  -- silêncio a cada aplicar). Com a chave, só entram ids de variante REAL do Tecido 1 deste mesmo payload.
  select coalesce(jsonb_object_agg(mt.tipo || '|' || mt.numero || '|' || mtv.variante_tecido_id::text,
                                   to_jsonb(mtv.complementa_variante_ids)), '{}'::jsonb)
    into v_comp_antes
  from modelo_tecido_variantes mtv
  join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id
  where mt.modelo_id = _modelo and mt.tipo in ('tecido','forro')
    and mtv.variante_tecido_id is not null and mtv.complementa_variante_ids is not null;
  select coalesce(array_agg(distinct (v2->>'variante_tecido_id')::uuid), '{}'::uuid[])
    into v_t1_ids
  from jsonb_array_elements(coalesce(_materiais, '[]'::jsonb)) m2
  cross join lateral jsonb_array_elements(coalesce(m2->'variantes', '[]'::jsonb)) v2
  where coalesce(nullif(m2->>'tipo',''), 'tecido') = 'tecido' and coalesce((m2->>'numero')::int, 1) = 1
    and nullif(m2->>'artigo_id','') is not null and nullif(v2->>'variante_tecido_id','') is not null;

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
      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),
              coalesce((v->>'multiplicador')::numeric, 1),
              case
                when v_tipo = 'tecido' and v_num = 1 then null   -- o Tecido 1 é a âncora: nunca casa
                when v ? 'complementa_variante_ids' then (
                  select nullif(array_agg(distinct x.id), '{}'::uuid[])
                  from (select (e.val)::uuid as id
                          from jsonb_array_elements_text(
                                 case when jsonb_typeof(v->'complementa_variante_ids') = 'array'
                                      then v->'complementa_variante_ids' else '[]'::jsonb end) as e(val)
                         where e.val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') x
                  where x.id = any(v_t1_ids))
                else (   -- chave ausente: PRESERVA o casamento anterior, SÓ com cores que seguem no Tecido 1 (PR13)
                  select nullif(array_agg(distinct x.id), '{}'::uuid[])
                  from (select (e.val)::uuid as id
                          from jsonb_array_elements_text(v_comp_antes -> (v_tipo || '|' || v_num || '|' || (v->>'variante_tecido_id'))) as e(val)) x
                  where x.id = any(v_t1_ids))
              end);
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
                      'grade_total', pv.grade_total,
                      'distribuicao', pv.distribuicao, 'atende', pv.atende
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
  -- 'distribuicao' entrou em 20261006100000 (Distribuição por produto): servidor = front (chave ausente = desligado).
  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha
  -- `useTenantModules.DEFAULTS`/`admin/lojas.tsx MODULE_DEFAULTS` no front. Módulos "clássicos"
  -- (criacao, entrada_saida, producao, financeiro, cadastro, dashboard) ficam de fora de
  -- propósito: chave ausente = ON pra eles (loja sem tenant_config não perde os módulos-núcleo).
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    _module NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao')
  );
$function$;

CREATE OR REPLACE FUNCTION public._direcionamento_plano_modelo_core(_modelo_id uuid, _tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_colecao text;
  v_colecao_id uuid;
  v_subcolecao text;
  v_origem text;
  v_tipo text;
  v_direcionados bigint := 0;
  v_base jsonb;
  v_slot uuid;
  v_tamanhos jsonb;
  v_plano jsonb;
BEGIN
  -- Distribuição por produto (20261006100000, spec R21/R38): o PLANO SALVO do Plan. Tecido para o Direcionamento, por
  -- modelo, só leitura. NÃO é gate de nada (invariante #10 — o Confirmar segue comparando com a Grade Real).
  SELECT NULLIF(btrim(m.colecao), ''), m.colecao_id, NULLIF(btrim(m.subcolecao), ''),
         COALESCE(NULLIF(m.origem, ''), 'interno'), CASE WHEN m.tamanho_tipo = 'numero' THEN 'numero' ELSE 'letra' END
    INTO v_colecao, v_colecao_id, v_subcolecao, v_origem, v_tipo
  FROM modelos m
  WHERE m.id = _modelo_id AND m.tenant_id = _tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING ERRCODE = 'P0001';
  END IF;
  -- Coleção-texto sem colecao_id (legado): resolve como a RPC antiga (PR18 — nota N2 do G-plano).
  IF v_colecao_id IS NULL AND v_colecao IS NOT NULL THEN
    SELECT c.id INTO v_colecao_id FROM colecoes c
     WHERE c.tenant_id = _tenant AND public._import_nome_norm(c.nome) = public._import_nome_norm(v_colecao)
     ORDER BY c.created_at LIMIT 1;
  END IF;

  -- "X modelos direcionados" (P-16 = C): a mesma conta da RPC antiga direcionamento_resumo_subcolecao.
  IF v_subcolecao IS NOT NULL THEN
    SELECT count(DISTINCT m2.id) INTO v_direcionados
    FROM modelos m2
    JOIN cad c ON c.modelo_id = m2.id
    WHERE m2.tenant_id = _tenant
      AND NULLIF(btrim(m2.colecao), '') IS NOT DISTINCT FROM v_colecao
      AND NULLIF(btrim(m2.subcolecao), '') IS NOT DISTINCT FROM v_subcolecao
      AND c.direcionamento_status = 'separado';
  END IF;
  v_base := jsonb_build_object('subcolecao', v_subcolecao, 'direcionados', v_direcionados);

  IF NOT public.tenant_module_enabled('distribuicao') THEN
    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'modulo_desligado');
  END IF;
  IF v_origem IN ('revenda', 'importado') THEN
    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'comprado');
  END IF;

  -- Slot do plano da COLEÇÃO ATUAL do modelo (prefere o que tem distribuição).
  SELECT sl.id INTO v_slot
  FROM plan_tecido_slots sl
  JOIN plan_tecido_linhas l ON l.id = sl.linha_ref_id
  JOIN plan_tecido_subcolecoes s ON s.id = l.sub_id
  JOIN plan_tecido p ON p.id = s.plan_id
  WHERE sl.modelo_id = _modelo_id AND sl.tenant_id = _tenant AND p.colecao_id = v_colecao_id
  ORDER BY EXISTS (SELECT 1 FROM plan_tecido_materiais pm
                     JOIN plan_tecido_variantes pv ON pv.material_id = pm.id
                    WHERE pm.slot_id = sl.id AND pm.tipo = 'tecido' AND pm.numero = 1
                      AND pv.distribuicao <> '{}'::jsonb) DESC,
           sl.slot_index, sl.id
  LIMIT 1;
  IF v_slot IS NULL THEN
    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'sem_plano_tecido');
  END IF;

  SELECT tc.tamanhos_grade INTO v_tamanhos FROM tenant_config tc WHERE tc.tenant_id = _tenant;
  v_tamanhos := COALESCE(v_tamanhos, '["34|PPP","36|PP","38|P","40|M","42|G","44|GG"]'::jsonb);

  WITH t1 AS (   -- cores do Tecido 1 do plano COM distribuição; variante_numero = ordem da variante no Tecido 1 do BOM
    SELECT pv.variante_tecido_id, pv.ordem, pv.distribuicao,
           COALESCE(c1.nome, c2.nome)::text AS cor_nome, COALESCE(a1.nome, a2.nome)::text AS apelido_nome,
           (SELECT min(mv.ordem) FROM modelo_tecido_variantes mv
              JOIN modelo_tecidos mt ON mt.id = mv.modelo_tecido_id
             WHERE mt.modelo_id = _modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1
               AND mv.variante_tecido_id = pv.variante_tecido_id) AS variante_numero
    FROM plan_tecido_materiais pm
    JOIN plan_tecido_variantes pv ON pv.material_id = pm.id
    LEFT JOIN variantes_tecido vt ON vt.id = pv.variante_tecido_id
    LEFT JOIN cores c1 ON c1.id = vt.cor_id
    LEFT JOIN cores_apelido a1 ON a1.id = vt.cor_apelido_id
    LEFT JOIN cores c2 ON c2.id = pv.cor_id
    LEFT JOIN cores_apelido a2 ON a2.id = pv.cor_apelido_id
    WHERE pm.slot_id = v_slot AND pm.tipo = 'tecido' AND pm.numero = 1
      AND jsonb_typeof(pv.distribuicao) = 'object' AND pv.distribuicao <> '{}'::jsonb
  ), cel AS (   -- 1 linha por (cor × loja), grade saneada (inteiro >= 0, T4 fix1 · F2: até 9 dígitos —
                 -- cabe em int4 com folga; um valor MAIOR na célula é IGNORADO em vez de estourar a RPC inteira)
    SELECT t1.variante_numero, t1.ordem, t1.cor_nome, t1.apelido_nome,
           CASE WHEN d.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (d.key)::uuid END AS loja_id, -- PR18/N3
           COALESCE((SELECT jsonb_object_agg(g.key, round((g.value)::numeric)::int)
                       FROM jsonb_each_text(CASE WHEN jsonb_typeof(d.value -> 'grades') = 'object'
                                                 THEN d.value -> 'grades' ELSE '{}'::jsonb END) g
                      WHERE g.value ~ '^[0-9]{1,9}([.][0-9]+)?$'), '{}'::jsonb) AS grades
    FROM t1
    CROSS JOIN LATERAL jsonb_each(t1.distribuicao) d
    WHERE d.key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), cel_ok AS (   -- só lojas desta loja (tenant) que ainda existem no cadastro
    SELECT cel.*, ld.nome AS loja_nome, ld.ativo, ld.is_default, ld.ordem AS loja_ordem,
           (SELECT COALESCE(sum((g.value)::int), 0) FROM jsonb_each_text(cel.grades) g) AS total
    FROM cel
    JOIN lojas_direcionamento ld ON ld.id = cel.loja_id AND ld.tenant_id = _tenant
  )
  SELECT jsonb_build_object(
    'tamanho_tipo', v_tipo,
    'tamanhos', v_tamanhos,
    'lojas', COALESCE((SELECT jsonb_agg(jsonb_build_object('loja_id', x.loja_id, 'nome', x.loja_nome, 'ativo', x.ativo,
                                                          'is_default', x.is_default, 'ordem', x.loja_ordem)
                                        ORDER BY x.is_default DESC, x.loja_ordem NULLS LAST, x.loja_nome)
                       FROM (SELECT DISTINCT loja_id, loja_nome, ativo, is_default, loja_ordem FROM cel_ok) x), '[]'::jsonb),
    'variantes', COALESCE((SELECT jsonb_agg(jsonb_build_object('variante_numero', t.variante_numero,
                                                              'variante_tecido_id', t.variante_tecido_id,
                                                              'cor_nome', t.cor_nome, 'apelido_nome', t.apelido_nome)
                                            ORDER BY t.variante_numero NULLS LAST, t.ordem)
                           FROM t1 t), '[]'::jsonb),
    'celulas', COALESCE((SELECT jsonb_agg(jsonb_build_object('loja_id', c.loja_id, 'variante_numero', c.variante_numero,
                                                            'grades', c.grades)
                                          ORDER BY c.variante_numero, c.is_default DESC, c.loja_ordem NULLS LAST)
                         FROM cel_ok c WHERE c.variante_numero IS NOT NULL), '[]'::jsonb),
    'sem_correspondencia', COALESCE((SELECT jsonb_agg(jsonb_build_object('cor_nome', s.cor_nome, 'apelido_nome', s.apelido_nome,
                                                                        'total', s.total) ORDER BY s.ordem)
                                     FROM (SELECT c.ordem, c.cor_nome, c.apelido_nome, sum(c.total) AS total
                                             FROM cel_ok c WHERE c.variante_numero IS NULL
                                            GROUP BY c.ordem, c.cor_nome, c.apelido_nome) s), '[]'::jsonb)
  ) INTO v_plano;

  IF jsonb_array_length(v_plano -> 'variantes') = 0 THEN
    RETURN v_base || jsonb_build_object('plano', NULL, 'motivo_sem_plano', 'sem_distribuicao');
  END IF;
  RETURN v_base || jsonb_build_object('plano', v_plano, 'motivo_sem_plano', NULL);
END $function$;

CREATE OR REPLACE FUNCTION public.direcionamento_plano_modelo(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  -- Distribuição por produto (20261006100000): wrapper — auth + loja ativa + módulo PCP; o _core faz o IDOR do modelo
  -- pelo tenant do CHAMADOR (nunca por parâmetro vindo do cliente) — invariante #9.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._direcionamento_plano_modelo_core(_modelo_id, v_tenant);
END $function$;

-- ACL (invariante #9): internas fechadas p/ PUBLIC/anon/authenticated; o wrapper só p/ authenticated.
REVOKE EXECUTE ON FUNCTION public._salvar_plan_tecido_core(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_gravar_bom_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._direcionamento_plano_modelo_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.direcionamento_plano_modelo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.direcionamento_plano_modelo(uuid) TO authenticated;
COMMENT ON FUNCTION public.direcionamento_plano_modelo(uuid) IS 'Distribuição por produto: plano SALVO do Plan. Tecido (loja × variante_numero × tamanho) + nº de modelos direcionados da subcoleção, p/ o Direcionamento. Só leitura; não é gate (invariante #10).';

ALTER TABLE public.plan_tecido_variantes
  ADD COLUMN IF NOT EXISTS distribuicao jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS atende jsonb;
DO $ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.plan_tecido_variantes'::regclass
                   AND conname = 'plan_tecido_variantes_distribuicao_objeto') THEN
    ALTER TABLE public.plan_tecido_variantes ADD CONSTRAINT plan_tecido_variantes_distribuicao_objeto
      CHECK (jsonb_typeof(distribuicao) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.plan_tecido_variantes'::regclass
                   AND conname = 'plan_tecido_variantes_atende_array') THEN
    ALTER TABLE public.plan_tecido_variantes ADD CONSTRAINT plan_tecido_variantes_atende_array
      CHECK (atende IS NULL OR jsonb_typeof(atende) = 'array');
  END IF;
END $ck$;
COMMENT ON COLUMN public.plan_tecido_variantes.distribuicao IS 'Distribuição por produto (SÓ Tecido 1): {loja_id: {base, grades {tamanho: q}, manuais [tamanho]}}. grades = células resolvidas (a Σ vira o pç).';
COMMENT ON COLUMN public.plan_tecido_variantes.atende IS '"Atende a" (fora do Tecido 1): NULL = automático pela cor base; array de chaves de cor do Tecido 1 (variante_tecido_id ou plan:cor|apelido) = escolhido à mão. Vira complementa_variante_ids no BOM.';

-- A árvore é LANGUAGE sql (valida as colunas no CREATE) — por isso só agora.
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
                        'grades', vv.grades, 'grade_total', vv.grade_total,
                        'distribuicao', vv.distribuicao, 'atende', vv.atende) order by vv.ordem)
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
REVOKE EXECUTE ON FUNCTION public._plan_tecido_arvore_core(uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_plan_tecido_core(uuid,jsonb,integer)')));
  IF v_md5 IS DISTINCT FROM '58fcaddadee3c7ab8cac44c0597c9368' THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — _salvar_plan_tecido_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_gravar_bom_core(uuid,jsonb)')));
  IF v_md5 IS DISTINCT FROM 'e13300caf9241a4ad9e0f36e5e26528b' THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — _plan_tecido_gravar_bom_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_snapshot(uuid)')));
  IF v_md5 IS DISTINCT FROM '75d43c800b38b08c77831a645dcb4b3d' THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — _plan_tecido_snapshot não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.tenant_module_enabled(text)')));
  IF v_md5 IS DISTINCT FROM '843163ccc128c53753ed08d3e4041cb3' THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — tenant_module_enabled não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_arvore_core(uuid)')));
  IF v_md5 IS DISTINCT FROM '137774116f4ec7fad102b6754a6decf3' THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — _plan_tecido_arvore_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._direcionamento_plano_modelo_core(uuid,uuid)')));
  IF v_md5 IS DISTINCT FROM 'f7d64d00d6219b56e2caec24252e3590' THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — _direcionamento_plano_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.direcionamento_plano_modelo(uuid)')));
  IF v_md5 IS DISTINCT FROM '734f015d27ccebbe4da028d6005a70e7' THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — direcionamento_plano_modelo não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.plan_tecido_variantes'::regclass AND a.attname = 'distribuicao' AND NOT a.attisdropped
       AND format_type(a.atttypid, a.atttypmod) = 'jsonb' AND a.attnotnull
       AND EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum
                    AND pg_get_expr(d.adbin, d.adrelid) = '''{}''::jsonb')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.plan_tecido_variantes'::regclass AND a.attname = 'atende' AND NOT a.attisdropped
       AND format_type(a.atttypid, a.atttypmod) = 'jsonb' AND NOT a.attnotnull
       AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.plan_tecido_variantes'::regclass
       AND conname = 'plan_tecido_variantes_distribuicao_objeto'
       AND pg_get_constraintdef(oid) LIKE '%jsonb_typeof(distribuicao) = ''object''%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.plan_tecido_variantes'::regclass
       AND conname = 'plan_tecido_variantes_atende_array'
       AND pg_get_constraintdef(oid) LIKE '%jsonb_typeof(atende) = ''array''%'
  ) THEN
    RAISE EXCEPTION 'distribuicao_produto: pós-condição falhou — colunas/CHECKs de plan_tecido_variantes incompletos ou com outra definição — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
