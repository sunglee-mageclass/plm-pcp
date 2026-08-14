-- 20260814100000_fix_salvar_colecao_preserva_subcolecoes.sql
-- FIX destrutivo: salvar coleção (PV e OTB) apagava TODA a árvore de Plan. Tecido.
--
-- Causa raiz: `salvar_colecao_pv` e `otb_salvar_colecao` faziam DELETE incondicional de
-- `colecao_subcolecoes` + reinsert com IDs NOVOS. Como `plan_tecido_subcolecoes.subcolecao_id`
-- era ON DELETE CASCADE, cada save de coleção apagava em silêncio subcolecoes → plan_tecido_*
-- (linhas → slots → materiais → variantes). Foi o que apagou a "Resort 27 Novo" (13/ago).
--
-- Correção em 2 camadas (mesma lição do ledger de estoque #4 e do CAD — CASCADE silencioso em
-- dado derivado CARO é proibido):
--   1) FK `plan_tecido_subcolecoes.subcolecao_id` -> ON DELETE NO ACTION (rede de segurança).
--   2) As 2 RPCs passam a fazer UPSERT preservando IDs: UPDATE nas subcoleções que continuam
--      (casa por id; na falta, por nome), INSERT nas novas, DELETE só nas removidas — e RAISE
--      P0001 (PT) se uma removida tiver Planejamento de Tecido vinculado.
--
-- As demais FKs CASCADE de colecao_subcolecoes (colecao_semanas, colecao_semana_categorias,
-- colecao_pv_itens, otb_simulacao_unidades) são dado DERIVADO barato que as RPCs regravam do
-- zero de propósito — ficam CASCADE. Só plan_tecido_subcolecoes é árvore cara.
-- Nenhuma outra RPC viva faz delete incondicional de colecao_subcolecoes (auditado:
-- `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%colecao_subcolecoes%'` = 7 funções; só
-- estas 2 deletavam a tabela toda).

begin;

-- ── Camada 1: FK deixa de cascatear ────────────────────────────────────────────────────────
alter table public.plan_tecido_subcolecoes
  drop constraint if exists plan_tecido_subcolecoes_subcolecao_id_fkey;
alter table public.plan_tecido_subcolecoes
  add constraint plan_tecido_subcolecoes_subcolecao_id_fkey
  foreign key (subcolecao_id) references public.colecao_subcolecoes(id) on delete no action;

-- ── Camada 2a: salvar_colecao_pv (fluxo Poder de Venda) ─────────────────────────────────────
-- Contrato preservado: (uuid, jsonb, jsonb) RETURNS uuid, SECURITY INVOKER, search_path public.
create or replace function public.salvar_colecao_pv(_id uuid, _header jsonb, _subcolecoes jsonb)
 returns uuid
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_id uuid := _id; v_sub jsonb; v_item jsonb; v_sub_id uuid; v_pid uuid;
  v_si int := 0; v_ii int;
  v_n_sub int; v_n_distintos int;
  v_claimed uuid[] := '{}';
  v_orfa text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  if coalesce(btrim(_header->>'nome'), '') = '' then raise exception 'Informe o nome da coleção.'; end if;

  if exists (select 1 from jsonb_array_elements(coalesce(_subcolecoes,'[]'::jsonb)) e where coalesce(btrim(e.value->>'nome'),'') = '') then
    raise exception 'Cada subcoleção precisa de um nome.';
  end if;
  select count(*), count(distinct lower(btrim(e.value->>'nome'))) into v_n_sub, v_n_distintos
    from jsonb_array_elements(coalesce(_subcolecoes,'[]'::jsonb)) e;
  if v_n_sub <> v_n_distintos then raise exception 'Há subcoleções com o mesmo nome — use nomes distintos.'; end if;
  if nullif(_header->>'mix_padrao_id','') is not null
     and not exists (select 1 from public.mix_padroes where id = (_header->>'mix_padrao_id')::uuid and tenant_id = public.get_user_tenant_id()) then
    raise exception 'Padrão do mix inválido.';
  end if;

  if v_id is null then
    insert into public.colecoes (nome, tipo, mes_id, ano_id, mix_padrao_id, poder_venda_meta, perda_markup, status)
    values (_header->>'nome', 'poder_venda', nullif(_header->>'mes_id','')::uuid, nullif(_header->>'ano_id','')::uuid,
            nullif(_header->>'mix_padrao_id','')::uuid, nullif(_header->>'poder_venda_meta','')::numeric,
            greatest(0, coalesce((_header->>'perda_markup')::numeric, 25)), 'rascunho')
    returning id into v_id;
  else
    update public.colecoes set
      nome = _header->>'nome', mes_id = nullif(_header->>'mes_id','')::uuid, ano_id = nullif(_header->>'ano_id','')::uuid,
      mix_padrao_id = nullif(_header->>'mix_padrao_id','')::uuid, poder_venda_meta = nullif(_header->>'poder_venda_meta','')::numeric,
      perda_markup = greatest(0, coalesce((_header->>'perda_markup')::numeric, 25))
    where id = v_id and tipo = 'poder_venda';
    if not found then raise exception 'Coleção não encontrada.'; end if;
    -- Itens (filhos das subcoleções) são derivados/baratos: regrava do zero.
    delete from public.colecao_pv_itens where colecao_id = v_id;
  end if;

  -- UPSERT das subcoleções PRESERVANDO IDs (NÃO apaga+reinsere — isso cascateava plan_tecido).
  for v_sub in select value from jsonb_array_elements(coalesce(_subcolecoes, '[]'::jsonb)) loop
    v_pid := nullif(v_sub->>'id','')::uuid;
    v_sub_id := null;
    if v_pid is not null and exists (select 1 from public.colecao_subcolecoes where id = v_pid and colecao_id = v_id) then
      v_sub_id := v_pid;                                  -- casa por id
    else
      select cs.id into v_sub_id from public.colecao_subcolecoes cs  -- na falta, casa por nome
       where cs.colecao_id = v_id and lower(btrim(cs.nome)) = lower(btrim(v_sub->>'nome'))
         and not (cs.id = any(v_claimed))
       order by cs.ordem limit 1;
    end if;

    if v_sub_id is not null then
      update public.colecao_subcolecoes set
        nome = btrim(v_sub->>'nome'), ordem = v_si,
        data_lancamento = nullif(v_sub->>'data_lancamento','')::date,
        datas_semanas = coalesce(v_sub->'datas_semanas', '{}'::jsonb),
        semanas = coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(v_sub->'semanas','[]'::jsonb)) x), '{}'::int[])
      where id = v_sub_id;
    else
      insert into public.colecao_subcolecoes (colecao_id, nome, ordem, data_lancamento, datas_semanas, semanas)
      values (v_id, btrim(v_sub->>'nome'), v_si, nullif(v_sub->>'data_lancamento','')::date,
              coalesce(v_sub->'datas_semanas', '{}'::jsonb),
              coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(v_sub->'semanas','[]'::jsonb)) x), '{}'::int[]))
      returning id into v_sub_id;
    end if;
    v_claimed := v_claimed || v_sub_id;
    v_si := v_si + 1;

    v_ii := 0;
    for v_item in select value from jsonb_array_elements(coalesce(v_sub->'itens', '[]'::jsonb)) loop
      insert into public.colecao_pv_itens (colecao_id, subcolecao_id, linha_id, a_parte, prof_cor, cores,
        preco_min, preco_max, qtd_semanas, ordem)
      values (v_id, v_sub_id, nullif(v_item->>'linha_id','')::uuid,
              coalesce((v_item->>'a_parte')::boolean, false),
              greatest(0, coalesce((v_item->>'prof_cor')::int, 0)), greatest(0, coalesce((v_item->>'cores')::int, 0)),
              greatest(0, coalesce((v_item->>'preco_min')::numeric, 0)), greatest(0, coalesce((v_item->>'preco_max')::numeric, 0)),
              coalesce(v_item->'qtd_semanas', '{}'::jsonb), v_ii);
      v_ii := v_ii + 1;
    end loop;
  end loop;

  -- Remoções: subcoleção que existia e não foi reivindicada. Bloqueia se tem Plan. Tecido.
  select cs.nome into v_orfa
    from public.colecao_subcolecoes cs
    join public.plan_tecido_subcolecoes pts on pts.subcolecao_id = cs.id
   where cs.colecao_id = v_id and not (cs.id = any(v_claimed))
   order by cs.ordem limit 1;
  if v_orfa is not null then
    raise exception 'A subcoleção "%" tem Planejamento de Tecido vinculado — remova o planejamento dela antes de excluí-la.', v_orfa using errcode='P0001';
  end if;
  delete from public.colecao_subcolecoes where colecao_id = v_id and not (id = any(v_claimed));

  return v_id;
end $function$;

-- ── Camada 2b: otb_salvar_colecao (fluxo Orçamento) ─────────────────────────────────────────
-- Contrato preservado: (jsonb) RETURNS uuid, SECURITY DEFINER, search_path public.
create or replace function public.otb_salvar_colecao(_payload jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_orfa     text;
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

  -- Regrava do zero: apaga semanas + distribuição (todos os níveis) da coleção (derivado/barato).
  delete from colecao_semana_categorias where colecao_id = v_id;
  delete from colecao_semanas where colecao_id = v_id;

  if v_has_subs then
    -- Subcoleções que continuam (as que trazem id). As demais serão removidas.
    select coalesce(array_agg(nullif(s->>'id','')::uuid) filter (where nullif(s->>'id','') is not null), '{}'::uuid[])
      into v_kept from jsonb_array_elements(v_subs) s;

    -- Antes de remover: bloqueia se alguma removida tem Planejamento de Tecido vinculado.
    select cs.nome into v_orfa
      from colecao_subcolecoes cs
      join plan_tecido_subcolecoes pts on pts.subcolecao_id = cs.id
     where cs.colecao_id = v_id and not (cs.id = any(v_kept))
     order by cs.ordem limit 1;
    if v_orfa is not null then
      raise exception 'A subcoleção "%" tem Planejamento de Tecido vinculado — remova o planejamento dela antes de excluí-la.', v_orfa using errcode='P0001';
    end if;
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
    -- Sem subcoleções: remove todas — mas bloqueia se alguma tem Planejamento de Tecido.
    select cs.nome into v_orfa
      from colecao_subcolecoes cs
      join plan_tecido_subcolecoes pts on pts.subcolecao_id = cs.id
     where cs.colecao_id = v_id
     order by cs.ordem limit 1;
    if v_orfa is not null then
      raise exception 'A subcoleção "%" tem Planejamento de Tecido vinculado — remova o planejamento dela antes de excluí-la.', v_orfa using errcode='P0001';
    end if;
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

-- ── Camada 1b: excluir coleção inteira precisa apagar plan_tecido ANTES ─────────────────────
-- Com a FK plan_tecido_subcolecoes.subcolecao_id agora NO ACTION, o cascade de `colecoes`
-- pode tentar apagar `colecao_subcolecoes` ANTES de `plan_tecido_subcolecoes` sumir (a ordem
-- do cascade não é garantida) e a checagem NO ACTION falha. Solução: excluir `plan_tecido`
-- (que cascateia toda a árvore) explicitamente antes — mesmo padrão que a função já usa p/
-- `modelos` (FK NO ACTION de colecoes→modelos). Excluir a coleção INTEIRA apaga o plan de
-- propósito (ação destrutiva já guardada por esta RPC); a proteção é contra o SAVE apagar.
create or replace function public.otb_excluir_colecao(_colecao_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_planejados int;
begin
  if not public.tenant_module_enabled('otb') then
    raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501';
  end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  perform 1 from colecoes where id = _colecao_id and tenant_id = v_tenant;
  if not found then raise exception 'Coleção não encontrada'; end if;

  select count(*) into v_planejados from modelos
    where tenant_id = v_tenant and colecao_id = _colecao_id and status_planejamento = 'planejado';
  if v_planejados > 0 then
    raise exception 'Não é possível excluir: % modelo(s) desta coleção já está(ão) em status planejado. Remova/reprove antes.', v_planejados;
  end if;

  perform set_config('app.otb_reconciling', 'on', true);
  delete from modelos where tenant_id = v_tenant and colecao_id = _colecao_id;
  -- apaga a árvore de Plan. Tecido antes do cascade de colecoes (FK NO ACTION em subcolecao_id)
  delete from plan_tecido where colecao_id = _colecao_id;
  delete from colecoes where id = _colecao_id and tenant_id = v_tenant;
end;
$function$;

-- ── ACLs: CREATE OR REPLACE preserva ACL, mas reafirmamos o estado exato (sem PUBLIC/anon) ───
revoke all on function public.salvar_colecao_pv(uuid, jsonb, jsonb) from public;
grant execute on function public.salvar_colecao_pv(uuid, jsonb, jsonb) to authenticated, service_role;
revoke all on function public.otb_salvar_colecao(jsonb) from public;
grant execute on function public.otb_salvar_colecao(jsonb) to authenticated, service_role;
revoke all on function public.otb_excluir_colecao(uuid) from public;
grant execute on function public.otb_excluir_colecao(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
