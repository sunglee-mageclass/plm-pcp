-- 20260814110000_blindagem_snapshots_e_guarda_aplicar.sql
-- Sequela do incidente de 13/ago (PITR ficará DESLIGADO). Duas blindagens de dados:
--
-- BLINDAGEM 1 — Snapshots de recuperação do "antes" (rede de segurança sem PITR):
--   * plan_tecido_snapshots  — árvore COMPLETA do plano ANTES de cada save (delete+reinsert
--     de ~500 linhas por save torna fn_audit por-linha inviável; 1 snapshot/save é O(1)).
--   * modelo_bom_snapshots   — BOM do modelo (tecidos/variantes/oc_links/aviamentos/grades +
--     proporcoes) ANTES de cada "Aplicar ao modelo" E de cada save do BOM do Dev.
--   Retenção DENTRO das RPCs: 20 últimos por plan/modelo + apaga >60 dias.
--   RLS: leitura tenant-scoped (admin da loja); escrita SÓ via RPC DEFINER (invariante #9).
--
-- BLINDAGEM 2 — Guarda vazio-sobre-preenchido no "Aplicar ao modelo":
--   _plan_tecido_aplicar_ao_modelo_core ganha _confirmar_sobrescrita (default false).
--   Se aplicar apagaria TODAS as variantes de um modelo que hoje tem variantes (ou zeraria
--   a grade já preenchida), RAISE P0001 em PT (hint='plan_tecido_sobrescrita') até confirmar.
--   Chamadas antigas (2 args) → default false = protegido.
--
-- Migração envolve DROP+CREATE (aplicar core+wrapper, p/ o param novo) → BEGIN/COMMIT.
-- Idempotente (guards IF EXISTS / OR REPLACE / REVOKE de privilégio ausente não erra).

begin;

-- ============================================================================
-- BLINDAGEM 1 — tabelas de snapshot
-- ============================================================================
-- SEM FK p/ plan_tecido/modelos de propósito: o snapshot é a REDE DE SEGURANÇA e precisa
-- sobreviver à exclusão do registro que ele protege (não cascatear junto).
create table if not exists public.plan_tecido_snapshots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  plan_id    uuid not null,
  colecao_id uuid not null,
  payload    jsonb not null,             -- { colecao_id, plan_id, arvore:{subcolecoes:[...]}, slot_oc:[...] } = ESTADO ANTERIOR
  user_id    uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_plan_tecido_snapshots_plan   on public.plan_tecido_snapshots(plan_id, created_at desc);
create index if not exists idx_plan_tecido_snapshots_tenant on public.plan_tecido_snapshots(tenant_id);

create table if not exists public.modelo_bom_snapshots (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  modelo_id  uuid not null,
  origem     text,                       -- 'aplicar' (Plan. Tecido) | 'dev_bom' (save do Dev)
  payload    jsonb not null,             -- { modelo_id, proporcoes, modelo_tecidos:[...], modelo_tecido_oc_links:[...], modelo_aviamentos:[...], modelo_grades:[...] } = ESTADO ANTERIOR
  user_id    uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_modelo_bom_snapshots_modelo on public.modelo_bom_snapshots(modelo_id, created_at desc);
create index if not exists idx_modelo_bom_snapshots_tenant on public.modelo_bom_snapshots(tenant_id);

-- RLS — padrão da audit_log: só admin da loja (ou super) LÊ; ninguém escreve direto
-- (as RPCs DEFINER, owner=postgres, furam RLS). Supabase concede anon/authenticated por
-- ALTER DEFAULT PRIVILEGES em tabela nova → REVOKE é necessário (não inócuo aqui).
alter table public.plan_tecido_snapshots enable row level security;
revoke all on public.plan_tecido_snapshots from anon, authenticated;
grant select on public.plan_tecido_snapshots to authenticated;
drop policy if exists snap_read_admin on public.plan_tecido_snapshots;
create policy snap_read_admin on public.plan_tecido_snapshots for select to authenticated
  using (public.is_super_admin() or (public.is_tenant_admin() and tenant_id = public.get_user_tenant_id()));

alter table public.modelo_bom_snapshots enable row level security;
revoke all on public.modelo_bom_snapshots from anon, authenticated;
grant select on public.modelo_bom_snapshots to authenticated;
drop policy if exists snap_read_admin on public.modelo_bom_snapshots;
create policy snap_read_admin on public.modelo_bom_snapshots for select to authenticated
  using (public.is_super_admin() or (public.is_tenant_admin() and tenant_id = public.get_user_tenant_id()));

-- ============================================================================
-- Helpers de snapshot (DEFINER, self-contained; EXECUTE revogado — invariante #9)
-- ============================================================================
-- Captura a árvore COMPLETA do plano na MESMA forma que _salvar_plan_tecido_core recebe
-- (`arvore.subcolecoes[...]`, ids de SLOT preservados) → restaurável por 1 chamada de
-- salvar_plan_tecido. `slot_oc` guardado à parte (o replay recaptura o slot_oc VIVO, não o
-- do snapshot). Pula quando não há nada a snapshotar (plano recém-criado).
create or replace function public._plan_tecido_snapshot(_plan_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
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

-- BOM do modelo: rows CRUAS (to_jsonb) das 4 tabelas + proporcoes = restaurável por INSERT
-- direto (preserva ids/vínculos). Pula quando o BOM está vazio (card recém-criado).
create or replace function public._modelo_bom_snapshot(_modelo_id uuid, _origem text default null)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare v_tenant uuid; v_payload jsonb;
begin
  select tenant_id into v_tenant from modelos where id = _modelo_id;
  if v_tenant is null then return; end if;

  if not exists (select 1 from modelo_tecidos where modelo_id = _modelo_id)
     and not exists (select 1 from modelo_grades where modelo_id = _modelo_id)
     and not exists (select 1 from modelo_aviamentos where modelo_id = _modelo_id)
     and not exists (select 1 from modelo_tecido_oc_links where modelo_id = _modelo_id)
     and coalesce((select proporcoes from modelos where id = _modelo_id), '{}'::jsonb) = '{}'::jsonb
  then
    return;  -- nada a snapshotar
  end if;

  select jsonb_build_object(
    'modelo_id', _modelo_id,
    'proporcoes', (select proporcoes from modelos where id = _modelo_id),
    'modelo_tecidos', coalesce((
      select jsonb_agg(to_jsonb(mt) || jsonb_build_object(
        'variantes', coalesce((
          select jsonb_agg(to_jsonb(mtv) order by mtv.ordem)
          from modelo_tecido_variantes mtv where mtv.modelo_tecido_id = mt.id), '[]'::jsonb)
      ) order by mt.tipo, mt.numero)
      from modelo_tecidos mt where mt.modelo_id = _modelo_id), '[]'::jsonb),
    'modelo_tecido_oc_links', coalesce((
      select jsonb_agg(to_jsonb(mol)) from modelo_tecido_oc_links mol where mol.modelo_id = _modelo_id), '[]'::jsonb),
    'modelo_aviamentos', coalesce((
      select jsonb_agg(to_jsonb(ma)) from modelo_aviamentos ma where ma.modelo_id = _modelo_id), '[]'::jsonb),
    'modelo_grades', coalesce((
      select jsonb_agg(to_jsonb(mg)) from modelo_grades mg where mg.modelo_id = _modelo_id), '[]'::jsonb)
  ) into v_payload;

  insert into modelo_bom_snapshots (tenant_id, modelo_id, origem, payload, user_id)
  values (v_tenant, _modelo_id, _origem, v_payload, auth.uid());

  -- retenção: 20 últimos por modelo + apaga >60 dias
  delete from modelo_bom_snapshots ms
  where ms.modelo_id = _modelo_id
    and ms.id not in (
      select id from modelo_bom_snapshots where modelo_id = _modelo_id
      order by created_at desc, id desc limit 20);
  delete from modelo_bom_snapshots where modelo_id = _modelo_id and created_at < now() - interval '60 days';
end $function$;

revoke execute on function public._plan_tecido_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public._modelo_bom_snapshot(uuid, text) from public, anon, authenticated;

-- ============================================================================
-- Liga o snapshot nas 3 RPCs core (CREATE OR REPLACE → ACL preservada).
-- Corpo idêntico ao vivo + exatamente 1 PERFORM de snapshot (diff-validável).
-- ============================================================================

-- (1) _salvar_plan_tecido_core: snapshot do "antes" logo após obter v_plan e ANTES do delete.
create or replace function public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb, _rev_base integer DEFAULT NULL::integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  -- bump da árvore do Plan. Tecido: NÃO precisa de update manual aqui. O insert/upsert em
  -- plan_tecido (topo desta função) já dispara trg_colab_bump (Task 1) → fn_colab_bump_plan()
  -- → UPDATE no-op em colecoes → trg_colab_plan_rev incrementa plan_rev em exatamente 1.
  -- (Um update explícito aqui SOMARIA um 2º bump — foi removido no fix round da revisão.)

  return v_plan;
end $function$;

-- (2) _plan_tecido_gravar_bom_core: snapshot do BOM ANTES dos deletes (cobre Aplicar E Criar card).
create or replace function public._plan_tecido_gravar_bom_core(_modelo uuid, _materiais jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

-- (3) _salvar_modelo_bom_core: snapshot do BOM ANTES dos deletes (save do BOM no Dev).
create or replace function public._salvar_modelo_bom_core(_modelo_id uuid, _tecidos jsonb, _aviamentos jsonb, _grades jsonb, _rev_base integer DEFAULT NULL::integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  t jsonb;
  a jsonb;
  g jsonb;
  v_new_tid uuid;
  v_variante uuid;
  v_oc_link jsonb;
  v_idx int;
  v_grades jsonb;
  v_grade_total numeric;
  v_has_value boolean;
BEGIN
  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.modelos
        where id = _modelo_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;

  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- [NOVO] Isolamento dos IDs aninhados: todos devem pertencer ao tenant do modelo.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    WHERE (tt->>'artigo_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.artigos x WHERE x.id=(tt->>'artigo_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Artigo de outra loja no BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'variantes')='array' THEN tt->'variantes' ELSE '[]'::jsonb END) vv
    WHERE jsonb_typeof(vv) <> 'null' AND (vv#>>'{}') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido x WHERE x.id=(vv#>>'{}')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Variante de tecido de outra loja no BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'oc_links')='array' THEN tt->'oc_links' ELSE '[]'::jsonb END) ol
    WHERE (ol->>'variante_tecido_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido x WHERE x.id=(ol->>'variante_tecido_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Variante do vínculo de OC de outra loja no BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'oc_links')='array' THEN tt->'oc_links' ELSE '[]'::jsonb END) ol
    WHERE (ol->>'oc_tecido_item_id') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        WHERE it.id=(ol->>'oc_tecido_item_id')::uuid AND oc.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Item de OC de outra loja no vínculo do BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_aviamentos)='array' THEN _aviamentos ELSE '[]'::jsonb END) aa
    WHERE (aa->>'aviamento_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.aviamentos x WHERE x.id=(aa->>'aviamento_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Aviamento de outra loja no BOM' USING ERRCODE='42501'; END IF;
  -- [/NOVO]

  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR do BOM (antes de qualquer delete)
  PERFORM public._modelo_bom_snapshot(_modelo_id, 'dev_bom');

  DELETE FROM public.modelo_tecido_variantes
    WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = _modelo_id);
  DELETE FROM public.modelo_tecido_oc_links WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_tecidos WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id;

  IF jsonb_typeof(_tecidos) = 'array' THEN
    FOR t IN SELECT value FROM jsonb_array_elements(COALESCE(_tecidos, '[]'::jsonb)) LOOP
      IF (t->>'artigo_id') IS NULL THEN CONTINUE; END IF;

      INSERT INTO public.modelo_tecidos
        (modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto)
      VALUES
        (_modelo_id,
         (t->>'artigo_id')::uuid,
         (t->>'numero')::int,
         t->>'tipo',
         COALESCE((t->>'consumo')::numeric, 0),
         COALESCE((t->>'loss_percent')::numeric, 0),
         COALESCE((t->>'custo_previsto')::numeric, 0))
      RETURNING id INTO v_new_tid;

      IF jsonb_typeof(t->'variantes') = 'array' THEN
        v_idx := 0;
        FOR v_variante IN
          SELECT CASE WHEN value::text = 'null' OR value IS NULL THEN NULL ELSE (value#>>'{}')::uuid END
          FROM jsonb_array_elements(t->'variantes')
        LOOP
          v_idx := v_idx + 1;
          IF v_variante IS NOT NULL THEN
            INSERT INTO public.modelo_tecido_variantes
              (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)
            VALUES (v_new_tid, v_variante, v_idx,
              COALESCE(NULLIF(t->'multiplicadores'->>(v_idx-1), '')::numeric, 1));
          END IF;
        END LOOP;
      END IF;

      IF jsonb_typeof(t->'oc_links') = 'array' THEN
        FOR v_oc_link IN SELECT value FROM jsonb_array_elements(t->'oc_links') LOOP
          IF (v_oc_link->>'oc_tecido_item_id') IS NULL
             OR (v_oc_link->>'variante_tecido_id') IS NULL THEN
            CONTINUE;
          END IF;
          INSERT INTO public.modelo_tecido_oc_links
            (modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
          VALUES
            (_modelo_id,
             t->>'tipo',
             (t->>'numero')::int,
             (v_oc_link->>'ordem')::int,
             (v_oc_link->>'variante_tecido_id')::uuid,
             (v_oc_link->>'oc_tecido_item_id')::uuid,
             COALESCE((v_oc_link->>'quantidade_m')::numeric, 0),
             COALESCE((v_oc_link->>'prioridade')::int, 1))
          ON CONFLICT (modelo_id, tipo, numero, ordem, oc_tecido_item_id)
          DO UPDATE SET
            quantidade_m = EXCLUDED.quantidade_m,
            prioridade = EXCLUDED.prioridade,
            variante_tecido_id = EXCLUDED.variante_tecido_id;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(_aviamentos) = 'array' THEN
    v_idx := 0;
    FOR a IN SELECT value FROM jsonb_array_elements(COALESCE(_aviamentos, '[]'::jsonb)) LOOP
      IF (a->>'aviamento_id') IS NULL THEN CONTINUE; END IF;
      v_idx := v_idx + 1;
      INSERT INTO public.modelo_aviamentos
        (modelo_id, aviamento_id, numero, consumo, loss_percent, custo_previsto)
      VALUES
        (_modelo_id,
         (a->>'aviamento_id')::uuid,
         COALESCE((a->>'numero')::int, v_idx),
         COALESCE((a->>'consumo')::numeric, 0),
         COALESCE((a->>'loss_percent')::numeric, 0),
         COALESCE((a->>'custo_previsto')::numeric, 0));
    END LOOP;
  END IF;

  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(COALESCE(_grades, '[]'::jsonb)) LOOP
      v_grades := COALESCE(g->'grades', '{}'::jsonb);
      v_grade_total := COALESCE((g->>'grade_total')::numeric, 0);
      v_has_value := false;
      IF v_grade_total > 0 THEN
        v_has_value := true;
      ELSIF jsonb_typeof(v_grades) = 'object' THEN
        SELECT EXISTS(
          SELECT 1 FROM jsonb_each_text(v_grades)
          WHERE NULLIF(value,'')::numeric > 0
        ) INTO v_has_value;
      END IF;
      IF v_has_value THEN
        INSERT INTO public.modelo_grades
          (modelo_id, variante_numero, grades, grade_total)
        VALUES
          (_modelo_id,
           (g->>'variante_numero')::int,
           v_grades,
           v_grade_total);
      END IF;
    END LOOP;
  END IF;
END;
$function$;

-- ============================================================================
-- BLINDAGEM 2 — guarda vazio-sobre-preenchido no "Aplicar ao modelo".
-- DROP+CREATE (param novo _confirmar_sobrescrita) → reaplica ACLs (invariante #9).
-- ============================================================================
drop function if exists public.plan_tecido_aplicar_ao_modelo(uuid, jsonb);
drop function if exists public._plan_tecido_aplicar_ao_modelo_core(uuid, jsonb);

create or replace function public._plan_tecido_aplicar_ao_modelo_core(_slot_id uuid, _materiais jsonb, _confirmar_sobrescrita boolean DEFAULT false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_modelo uuid; v_tenant uuid; v_lancado boolean;
  v_ocs uuid[];
  rec record;
  v_grade_total numeric;
  v_need numeric;
  v_cur_var_count int;
  v_new_var_count int;
  v_cur_grade_filled boolean;
  v_new_grade_filled boolean;
begin
  select modelo_id, tenant_id into v_modelo, v_tenant from plan_tecido_slots where id = _slot_id;
  if v_tenant is null or v_tenant is distinct from public.get_user_tenant_id() then
    raise exception 'Sem permissão sobre este item.' using errcode = '42501';
  end if;
  if v_modelo is null then
    raise exception 'Este item não está ligado a um modelo. Crie o card antes de aplicar.' using errcode = 'P0001';
  end if;
  select lancado into v_lancado from modelos where id = v_modelo;
  if coalesce(v_lancado, false) then
    raise exception 'Modelo já lançado — não é possível alterar o BOM.' using errcode = '42501';
  end if;

  -- [BLINDAGEM 2] guarda vazio-sobre-preenchido: aplicar rescreve tecido/forro+grade do modelo.
  -- Se o payload esvaziaria variantes hoje existentes (ou zeraria a grade preenchida), exige
  -- _confirmar_sobrescrita. hint estável 'plan_tecido_sobrescrita' → front abre AlertDialog.
  if not _confirmar_sobrescrita then
    select count(*) into v_cur_var_count
    from modelo_tecido_variantes mtv
    join modelo_tecidos mt on mt.id = mtv.modelo_tecido_id
    where mt.modelo_id = v_modelo and mt.tipo in ('tecido','forro');

    select count(*) into v_new_var_count
    from jsonb_array_elements(coalesce(_materiais,'[]'::jsonb)) m
    cross join lateral jsonb_array_elements(coalesce(m->'variantes','[]'::jsonb)) v
    where coalesce(nullif(m->>'tipo',''),'tecido') in ('tecido','forro')
      and nullif(v->>'variante_tecido_id','') is not null;

    select exists(select 1 from modelo_grades where modelo_id = v_modelo and coalesce(grade_total,0) > 0)
      into v_cur_grade_filled;

    select exists(
      select 1 from jsonb_array_elements(coalesce(_materiais,'[]'::jsonb)) m
      cross join lateral jsonb_array_elements(coalesce(m->'variantes','[]'::jsonb)) v
      where coalesce(nullif(m->>'tipo',''),'tecido') = 'tecido'
        and coalesce((m->>'numero')::int,1) = 1
        and coalesce((v->>'grade_total')::numeric,0) > 0
    ) into v_new_grade_filled;

    if v_cur_var_count > 0 and v_new_var_count = 0 then
      raise exception 'Aplicar apagaria % cor(es) já cadastrada(s) no modelo — confirme para prosseguir.', v_cur_var_count
        using errcode = 'P0001', hint = 'plan_tecido_sobrescrita';
    elsif v_cur_grade_filled and not v_new_grade_filled then
      raise exception 'Aplicar zeraria a grade já preenchida do modelo — confirme para prosseguir.'
        using errcode = 'P0001', hint = 'plan_tecido_sobrescrita';
    end if;
  end if;

  perform public._plan_tecido_gravar_bom_core(v_modelo, _materiais);

  -- aplica também a PROPORÇÃO do plano (senão só a grade mudava, não a proporção do modelo)
  update modelos m set proporcoes = sl.proporcoes
    from plan_tecido_slots sl
    where sl.id = _slot_id and m.id = v_modelo
      and sl.proporcoes is not null and jsonb_typeof(sl.proporcoes) = 'object' and sl.proporcoes <> '{}'::jsonb;

  -- PROPAGA a(s) OC(s) do plano p/ o vínculo do Dev (só quando o plano especifica OC).
  select array_agg(oc_tecido_id) into v_ocs from plan_tecido_slot_oc where slot_id = _slot_id;
  if v_ocs is not null and array_length(v_ocs, 1) > 0 then
    -- Reescreve SÓ as variantes que as OCs do plano cobrem (mesma variante existe em item de v_ocs).
    -- Preserva vínculos de variantes que o plano NÃO cobre (ex.: forro em OC separada).
    delete from modelo_tecido_oc_links l
      where l.modelo_id = v_modelo and l.tipo in ('tecido','forro')
        and exists (
          select 1 from public.ocs_tecido_itens it
          where it.oc_tecido_id = any(v_ocs) and it.variante_tecido_id = l.variante_tecido_id
        );

    for rec in
      select mt.tipo, mt.numero, mt.consumo, mt.loss_percent,
             mtv.ordem, mtv.variante_tecido_id, mtv.multiplicador
      from modelo_tecidos mt
      join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
      where mt.modelo_id = v_modelo and mt.tipo in ('tecido','forro')
    loop
      v_grade_total := coalesce(
        (select mg.grade_total from modelo_grades mg
          where mg.modelo_id = v_modelo and mg.variante_numero = rec.ordem), 0);
      v_need := coalesce(rec.consumo, 0)
              * (1 + coalesce(rec.loss_percent, 0) / 100.0)
              * v_grade_total
              * coalesce(rec.multiplicador, 1);

      insert into modelo_tecido_oc_links
        (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
      select v_tenant, v_modelo, rec.tipo, rec.numero, rec.ordem, rec.variante_tecido_id,
             a.item_id, a.q, a.rn
      from (
        with cand as (
          -- renumera 1..n APÓS filtrar às OCs do slot (o ord do array inteiro pularia números)
          select item_id, saldo, row_number() over (order by ord) as rn
          from (
            select (e->>'oc_tecido_item_id')::uuid as item_id,
                   greatest(0, coalesce((e->>'disponivel_m')::numeric, 0)) as saldo,
                   ord
            from jsonb_array_elements(public.ocs_disponiveis_variante(rec.variante_tecido_id, v_modelo))
                   with ordinality as t(e, ord)
            where exists (
              select 1 from public.ocs_tecido_itens it
              where it.id = (e->>'oc_tecido_item_id')::uuid and it.oc_tecido_id = any(v_ocs)
            )
          ) s
        ),
        cum as (
          select item_id, saldo, rn,
                 coalesce(sum(saldo) over (order by rn rows between unbounded preceding and 1 preceding), 0) as prev
          from cand
        )
        select item_id, rn,
               round(greatest(0, least(saldo, v_need - prev))::numeric, 2) as q
        from cum
        -- só itens que recebem alocação (q>0); garante ≥1 vínculo (o 1º) p/ a OC aparecer
        -- selecionada mesmo com necessidade 0. Evita vínculos q=0 excedentes (reserva fantasma).
        where greatest(0, least(saldo, v_need - prev)) > 0 or rn = 1
      ) a;
    end loop;
  end if;

  return v_modelo;
end $function$;

create or replace function public.plan_tecido_aplicar_ao_modelo(_slot_id uuid, _materiais jsonb, _confirmar_sobrescrita boolean DEFAULT false)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_aplicar_ao_modelo_core(_slot_id, _materiais, _confirmar_sobrescrita);
end $function$;

-- ACLs (invariante #9): o _core nasce com EXECUTE p/ PUBLIC no DROP+CREATE → revoga dos TRÊS.
-- O wrapper precisa ficar chamável por authenticated (faz auth/tenant check por dentro) — só
-- REVOKE de PUBLIC e anon (bônus: fecha o anon=true LATENTE que o wrapper tinha antes deste fix).
revoke execute on function public._plan_tecido_aplicar_ao_modelo_core(uuid, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.plan_tecido_aplicar_ao_modelo(uuid, jsonb, boolean) from public, anon;
grant execute on function public.plan_tecido_aplicar_ao_modelo(uuid, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';
commit;
