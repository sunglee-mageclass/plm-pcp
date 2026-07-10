-- OTB Poder de Venda: Padrão do mix + Coleção PV passam a ser POR LINHA (nº de modelos
-- → % derivada), SEM categoria/subcategoria em todo o fluxo. Decisões do dono:
--   • Eliminar cat/sub do padrão, da coleção PV e dos cards gerados.
--   • Por linha: nº de modelos (→ %), toggle "à parte" (Acessórios = 100% sozinha, o
--     resto soma 100%), prof/cor, nº de cores, faixa de preço mín/máx (migrada de cat+sub).
-- Idempotente (guards por existência) — os itens PV beta existentes foram re-semeados.

-- ============ 1) mix_padrao_linhas: novas colunas + backfill + dropa pct ============
ALTER TABLE public.mix_padrao_linhas
  ADD COLUMN IF NOT EXISTS num_modelos int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS a_parte boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preco_min numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS preco_max numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  -- Preço da linha = menor mín (>0) / maior máx das categorias que ela tinha.
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mix_padrao_categorias') THEN
    UPDATE public.mix_padrao_linhas l SET
      preco_min = COALESCE((SELECT min(c.preco_min) FROM public.mix_padrao_categorias c WHERE c.padrao_linha_id = l.id AND c.preco_min > 0), 0),
      preco_max = COALESCE((SELECT max(c.preco_max) FROM public.mix_padrao_categorias c WHERE c.padrao_linha_id = l.id), 0);
  END IF;
  -- Nº de modelos = a % antiga arredondada (ponto de partida; a % agora é derivada).
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mix_padrao_linhas' AND column_name='pct') THEN
    UPDATE public.mix_padrao_linhas SET num_modelos = GREATEST(0, round(pct)::int);
  END IF;
END $$;

ALTER TABLE public.mix_padrao_linhas DROP COLUMN IF EXISTS pct;
DROP TABLE IF EXISTS public.mix_padrao_categorias;

-- ============ 2) trigger de tenant dos itens PV: sem categoria/subcategoria ==========
-- (referenciava NEW.categoria_id/NEW.subcategoria1_id — quebra após o drop das colunas.)
CREATE OR REPLACE FUNCTION public.enforce_pv_itens_tenant()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare v_t uuid; v_esperado uuid := coalesce(NEW.tenant_id, public.get_user_tenant_id());
begin
  if NEW.linha_id is not null then
    select tenant_id into v_t from linhas where id = NEW.linha_id;
    if v_t is distinct from v_esperado then raise exception 'Linha de outra loja' using errcode='42501'; end if;
  end if;
  if NEW.colecao_id is not null then
    select tenant_id into v_t from colecoes where id = NEW.colecao_id;
    if v_t is distinct from v_esperado then raise exception 'Coleção de outra loja' using errcode='42501'; end if;
  end if;
  return NEW;
end $function$;

-- ============ 3) colecao_pv_itens: dropa categoria/subcategoria ======================
ALTER TABLE public.colecao_pv_itens DROP COLUMN IF EXISTS categoria_id, DROP COLUMN IF EXISTS subcategoria1_id;

-- ============ 4) salvar_mix_padrao: por linha (nº modelos + à parte + preço) =========
CREATE OR REPLACE FUNCTION public.salvar_mix_padrao(_id uuid, _nome text, _linhas jsonb)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare v_id uuid := _id; v_lin jsonb; v_i int := 0;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado' using errcode='42501'; end if;
  if coalesce(btrim(_nome), '') = '' then raise exception 'Informe o nome do padrão.'; end if;

  if v_id is null then
    insert into public.mix_padroes (nome) values (_nome) returning id into v_id;
  else
    update public.mix_padroes set nome = _nome where id = v_id;
    if not found then raise exception 'Padrão não encontrado.'; end if;
    delete from public.mix_padrao_linhas where padrao_id = v_id;
  end if;

  for v_lin in select value from jsonb_array_elements(coalesce(_linhas, '[]'::jsonb)) loop
    insert into public.mix_padrao_linhas (padrao_id, linha_id, num_modelos, a_parte, prof_cor, cores, preco_min, preco_max, ordem)
    values (v_id, nullif(v_lin->>'linha_id','')::uuid,
            greatest(0, coalesce((v_lin->>'num_modelos')::int, 0)),
            coalesce((v_lin->>'a_parte')::boolean, false),
            greatest(0, coalesce((v_lin->>'prof_cor')::int, 0)),
            greatest(0, coalesce((v_lin->>'cores')::int, 0)),
            greatest(0, coalesce((v_lin->>'preco_min')::numeric, 0)),
            greatest(0, coalesce((v_lin->>'preco_max')::numeric, 0)),
            v_i);
    v_i := v_i + 1;
  end loop;
  return v_id;
end $function$;

-- ============ 5) salvar_colecao_pv: itens sem categoria/subcategoria ================
CREATE OR REPLACE FUNCTION public.salvar_colecao_pv(_id uuid, _header jsonb, _subcolecoes jsonb)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
declare
  v_id uuid := _id; v_sub jsonb; v_item jsonb; v_sub_id uuid; v_si int := 0; v_ii int;
  v_n_sub int; v_n_distintos int;
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
    delete from public.colecao_pv_itens where colecao_id = v_id;
    delete from public.colecao_subcolecoes where colecao_id = v_id;
  end if;

  for v_sub in select value from jsonb_array_elements(coalesce(_subcolecoes, '[]'::jsonb)) loop
    insert into public.colecao_subcolecoes (colecao_id, nome, ordem, data_lancamento, semanas)
    values (v_id, btrim(v_sub->>'nome'), v_si, nullif(v_sub->>'data_lancamento','')::date,
            coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(coalesce(v_sub->'semanas','[]'::jsonb)) x), '{}'::int[]))
    returning id into v_sub_id;
    v_si := v_si + 1;
    v_ii := 0;
    for v_item in select value from jsonb_array_elements(coalesce(v_sub->'itens', '[]'::jsonb)) loop
      insert into public.colecao_pv_itens (colecao_id, subcolecao_id, linha_id, prof_cor, cores,
        preco_min, preco_max, qtd_semanas, ordem)
      values (v_id, v_sub_id, nullif(v_item->>'linha_id','')::uuid,
              greatest(0, coalesce((v_item->>'prof_cor')::int, 0)), greatest(0, coalesce((v_item->>'cores')::int, 0)),
              greatest(0, coalesce((v_item->>'preco_min')::numeric, 0)), greatest(0, coalesce((v_item->>'preco_max')::numeric, 0)),
              coalesce(v_item->'qtd_semanas', '{}'::jsonb), v_ii);
      v_ii := v_ii + 1;
    end loop;
  end loop;
  return v_id;
end $function$;

-- ============ 6) otb_confirmar_pv: bucket = subcoleção × linha × semana (sem cat/sub) ==
CREATE OR REPLACE FUNCTION public.otb_confirmar_pv(_colecao_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_col record; v_bk record;
  v_criados int := 0; v_removidos int := 0; v_existing int; v_diff int; v_removable uuid[];
begin
  if not public.tenant_module_enabled('otb') then raise exception 'Módulo otb não habilitado para esta loja' using errcode='42501'; end if;
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  select * into v_col from colecoes where id = _colecao_id and tenant_id = v_tenant and tipo = 'poder_venda';
  if not found then raise exception 'Coleção (poder de venda) não encontrada'; end if;

  perform set_config('app.otb_reconciling', 'on', true);

  for v_bk in
    select sc.nome as subcol, sc.data_lancamento, it.linha_id,
           e.key as semana, sum(e.value::int) as target
    from colecao_pv_itens it
    join colecao_subcolecoes sc on sc.id = it.subcolecao_id
    cross join lateral jsonb_each_text(it.qtd_semanas) as e(key, value)
    where it.colecao_id = _colecao_id and it.tenant_id = v_tenant and e.value ~ '^[0-9]+$' and e.value::int > 0
    group by sc.nome, sc.data_lancamento, it.linha_id, e.key
  loop
    select count(*) into v_existing from modelos
      where tenant_id = v_tenant and colecao_id = _colecao_id
        and coalesce(semana,'') = v_bk.semana and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
        and coalesce(linha_id::text,'') = coalesce(v_bk.linha_id::text,'');
    v_diff := v_bk.target - v_existing;

    if v_diff > 0 then
      insert into modelos (tenant_id, colecao_id, colecao, subcolecao, semana, data_lancamento, linha_id,
                           categoria_principal_id, subcategoria1_id, mes_id, ano_id,
                           status_planejamento, versao, nome, preco_venda,
                           tecidos_planejados, fotos_modelo, fotos_referencia, observacoes_gerais)
      select v_tenant, _colecao_id, v_col.nome, v_bk.subcol, v_bk.semana, v_bk.data_lancamento, v_bk.linha_id,
             null, null, v_col.mes_id, v_col.ano_id,
             'em_planejamento', 1, '', null, '{}'::uuid[], '{}'::text[], '{}'::text[], ''
      from generate_series(1, v_diff);
      v_criados := v_criados + v_diff;
    elsif v_diff < 0 then
      select array_agg(id) into v_removable from (
        select id from modelos
        where tenant_id = v_tenant and colecao_id = _colecao_id
          and coalesce(semana,'') = v_bk.semana and coalesce(subcolecao,'') = coalesce(v_bk.subcol,'')
          and coalesce(linha_id::text,'') = coalesce(v_bk.linha_id::text,'')
          and status_planejamento in ('em_planejamento','reprovado')
          and coalesce(nome,'') = '' and estilista_id is null and preco_venda is null and lancado = false
          and cardinality(coalesce(fotos_modelo,'{}')) = 0
        limit (v_existing - v_bk.target)
      ) t;
      if v_removable is not null then
        delete from modelos where id = any(v_removable);
        v_removidos := v_removidos + array_length(v_removable, 1);
      end if;
    end if;
  end loop;

  delete from modelos m
  where m.tenant_id = v_tenant and m.colecao_id = _colecao_id
    and m.status_planejamento in ('em_planejamento','reprovado')
    and coalesce(m.nome,'') = '' and m.estilista_id is null and m.preco_venda is null and m.lancado = false
    and cardinality(coalesce(m.fotos_modelo,'{}')) = 0
    and not exists (
      select 1 from colecao_pv_itens it
      join colecao_subcolecoes sc on sc.id = it.subcolecao_id
      cross join lateral jsonb_each_text(it.qtd_semanas) as e(key, value)
      where it.colecao_id = _colecao_id and e.value ~ '^[0-9]+$' and e.value::int > 0
        and coalesce(sc.nome,'') = coalesce(m.subcolecao,'') and e.key = coalesce(m.semana,'')
        and coalesce(it.linha_id::text,'') = coalesce(m.linha_id::text,'')
    );
  get diagnostics v_diff = row_count;
  v_removidos := v_removidos + v_diff;

  update modelos m set mes_id = v_col.mes_id, ano_id = v_col.ano_id
  where m.tenant_id = v_tenant and m.colecao_id = _colecao_id
    and m.status_planejamento in ('em_planejamento','reprovado')
    and coalesce(m.nome,'') = '' and m.estilista_id is null and m.preco_venda is null and m.lancado = false
    and (m.mes_id is distinct from v_col.mes_id or m.ano_id is distinct from v_col.ano_id);
  update modelos m set data_lancamento = sc.data_lancamento
  from colecao_subcolecoes sc
  where sc.colecao_id = _colecao_id and coalesce(sc.nome,'') = coalesce(m.subcolecao,'')
    and m.tenant_id = v_tenant and m.colecao_id = _colecao_id
    and m.status_planejamento in ('em_planejamento','reprovado')
    and coalesce(m.nome,'') = '' and m.estilista_id is null and m.preco_venda is null and m.lancado = false
    and m.data_lancamento is distinct from sc.data_lancamento;

  update colecoes set status = 'confirmada' where id = _colecao_id and tenant_id = v_tenant;
  perform set_config('app.otb_reconciling', 'off', true);
  return jsonb_build_object('criados', v_criados, 'removidos', v_removidos);
end $function$;
