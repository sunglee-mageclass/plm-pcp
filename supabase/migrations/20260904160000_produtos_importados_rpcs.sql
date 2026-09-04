-- Produtos Importados — Fase 1 (persistência): RPCs de salvar/criar-card + custo landed.
-- Espelha ESTRUTURALMENTE as RPCs da Revenda (20260807150000/151000/170000/20260812110000),
-- adaptando o CUSTO: em vez de valor_unitario×(1-desc)+insumos, o custo é o LANDED (cadeia de
-- câmbio M1→M2→BRL com etapas de pagamento + frete rateado). O helper `_imp_custo_landed`
-- espelha BYTE-A-BYTE `custoLanded` de src/lib/moeda.ts.
-- Padrão wrapper + _core + REVOKE dos três (invariante #9); gate produto_importado.
-- Idempotente (create or replace); envolto em BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: custo landed unitário (BRL) a partir dos dados do produto importado.
-- Espelha src/lib/moeda.ts `custoLanded`:
--   mercadoria_liq_M1 = valor_unitario_m1 × qtd × (1 - desc/100)
--   frete_liq_M2      = peso_kg × transporte_m2 × qtd × (1 - desc/100)
--   mercadoria_M2 = Σ etapas 'mercadoria': (%×mercadoria_liq_M1) ÷ cotacao   (M1→M2 divide)
--                   (sem etapa de mercadoria → 0)
--   frete_M2      = Σ etapas 'frete': (%×frete_liq_M2) ÷ (cotacao se >0 e ≠1, senão 1)
--                   (sem etapa de frete → frete_liq_M2 inteiro)
--   total_M2 = mercadoria_M2 + frete_M2 ;  total_BRL = total_M2 × cotacao_final
--   unitario_BRL = total_BRL ÷ qtd  (qtd 0 → 0)
-- Retorna o custo unitário landed em BRL.
create or replace function public._imp_custo_landed(_produto_id uuid) returns numeric
language plpgsql stable security definer set search_path to 'public' as $$
declare
  p record;
  v_desc numeric;
  v_merc_liq_m1 numeric;
  v_frete_liq_m2 numeric;
  v_merc_m2 numeric := 0;
  v_frete_m2 numeric := 0;
  v_tem_etapa_merc boolean;
  v_tem_etapa_frete boolean;
  v_total_m2 numeric;
  v_total_brl numeric;
begin
  select valor_unitario_m1, qtd_total, peso_kg, transporte_m2, desconto_pct, cotacao_final
    into p
    from public.produtos_importados where id = _produto_id;
  if not found or coalesce(p.qtd_total,0) <= 0 then
    return 0;
  end if;

  v_desc := 1 - coalesce(p.desconto_pct,0) / 100.0;
  v_merc_liq_m1 := coalesce(p.valor_unitario_m1,0) * p.qtd_total * v_desc;
  v_frete_liq_m2 := coalesce(p.peso_kg,0) * coalesce(p.transporte_m2,0) * p.qtd_total * v_desc;

  v_tem_etapa_merc := exists(select 1 from public.produto_importado_etapas where produto_importado_id = _produto_id and base = 'mercadoria');
  v_tem_etapa_frete := exists(select 1 from public.produto_importado_etapas where produto_importado_id = _produto_id and base = 'frete');

  -- mercadoria: cada etapa converte seu pedaço M1→M2 (÷ cotacao, cotacao≤0 → 0)
  if v_tem_etapa_merc then
    select coalesce(sum(
      case when coalesce(e.cotacao,0) > 0
        then (v_merc_liq_m1 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
        else 0 end
    ), 0) into v_merc_m2
    from public.produto_importado_etapas e
    where e.produto_importado_id = _produto_id and e.base = 'mercadoria';
  end if;

  -- frete: já em M2; ÷ cotacao só se >0 e ≠1 (default 1 = identidade)
  if v_tem_etapa_frete then
    select coalesce(sum(
      case when coalesce(e.cotacao,0) > 0 and e.cotacao <> 1
        then (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
        else (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) end
    ), 0) into v_frete_m2
    from public.produto_importado_etapas e
    where e.produto_importado_id = _produto_id and e.base = 'frete';
  else
    v_frete_m2 := v_frete_liq_m2; -- sem etapa de frete → frete inteiro em M2
  end if;

  v_total_m2 := v_merc_m2 + v_frete_m2;
  v_total_brl := v_total_m2 * coalesce(p.cotacao_final,0);
  return v_total_brl / p.qtd_total;
end $$;
revoke execute on function public._imp_custo_landed(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Recompute de preços do modelo espelho (custo landed → atacado → varejo).
-- Espelha `_pa_recomputar_precos_modelo` mas com o custo LANDED (não valor×desc+insumos).
create or replace function public._imp_recomputar_precos_modelo(_produto_id uuid) returns void
language plpgsql security definer set search_path to 'public' as $$
declare
  v_modelo_id uuid;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.markup_atacado, p.markup_varejo
    into v_modelo_id, v_markup_atacado, v_markup_varejo
    from public.produtos_importados p where p.id = _produto_id;
  if v_modelo_id is null then
    return; -- sem espelho ainda
  end if;

  v_custo := public._imp_custo_landed(_produto_id);

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  v_preco_atacado := case when v_markup_atacado is not null and v_markup_atacado > 0
    then round(v_custo * v_markup_atacado, 2) else v_atacado_atual end;
  v_preco_venda := case when v_preco_atacado is not null and v_markup_varejo is not null and v_markup_varejo > 0
    then round(v_preco_atacado * v_markup_varejo, 2) else v_venda_atual end;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end $$;
revoke execute on function public._imp_recomputar_precos_modelo(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- salvar_produto_importado: upsert do produto + variantes + etapas.
-- _dados = escalares do produto; _variantes = [{ordem,cor_id,cor_apelido_id,peso,qtd}];
-- _etapas = [{ordem,rotulo,base,percentual,data_vencimento,cotacao}].
create or replace function public._salvar_produto_importado_core(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_soma_merc numeric;
  v_soma_frete numeric;
  rec jsonb;
  v_ord int;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome','');
  v_grupo_id := nullif(_dados->>'grupo_id','')::uuid;
  v_categoria_id := nullif(_dados->>'categoria_id','')::uuid;

  -- Validação Σ% por base = 100 (só quando há etapas da base).
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_merc
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'mercadoria';
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_frete
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'frete';
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='mercadoria') and round(v_soma_merc,2) <> 100 then
    raise exception 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='frete') and round(v_soma_frete,2) <> 100 then
    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';
  end if;

  if _id is null then
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    insert into public.produtos_importados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor,
      composicao, grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, markup_atacado, markup_varejo
    ) values (
      -- ref: se o usuário digitou uma REF manual, ela é gravada e o trigger fn_produto_importado_ref
      -- NÃO a sobrescreve (ele só gera quando new.ref é vazio). Senão null → trigger gera a automática.
      v_tenant, v_nome, nullif(_dados->>'ref',''), v_grupo_id, v_categoria_id,
      nullif(_dados->>'subcategoria1_id','')::uuid, nullif(_dados->>'subcategoria2_id','')::uuid,
      nullif(_dados->>'colecao_id','')::uuid, nullif(_dados->>'subcolecao',''), nullif(_dados->>'semana',''),
      nullif(_dados->>'empresa_id','')::uuid, nullif(_dados->>'representante_id','')::uuid, nullif(_dados->>'ref_fornecedor',''),
      nullif(_dados->>'composicao',''), coalesce(_dados->'grade_proporcao','{}'::jsonb), coalesce((_dados->>'qtd_total')::int,0),
      nullif(_dados->>'foto_url',''), nullif(_dados->>'data_pedido','')::date, nullif(_dados->>'data_prevista','')::date, nullif(_dados->>'data_entrega','')::date,
      coalesce(nullif(_dados->>'moeda_compra',''),'RMB'), nullif(_dados->>'moeda_intermediaria',''),
      coalesce((_dados->>'valor_unitario_m1')::numeric,0), coalesce((_dados->>'cotacao_ref')::numeric,0),
      coalesce((_dados->>'peso_kg')::numeric,0), coalesce((_dados->>'transporte_m2')::numeric,0),
      coalesce((_dados->>'desconto_pct')::numeric,0), coalesce((_dados->>'cotacao_final')::numeric,0),
      nullif(_dados->>'markup_atacado','')::numeric, nullif(_dados->>'markup_varejo','')::numeric
    ) returning id into v_id;
  else
    update public.produtos_importados set
      nome = coalesce(v_nome, nome),
      -- ref: grava a manual digitada; se vier vazia, mantém a atual (não zera a REF existente).
      ref = coalesce(nullif(_dados->>'ref',''), ref),
      grupo_id = coalesce(v_grupo_id, grupo_id),
      categoria_id = coalesce(v_categoria_id, categoria_id),
      subcategoria1_id = nullif(_dados->>'subcategoria1_id','')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id','')::uuid,
      subcolecao = nullif(_dados->>'subcolecao',''),
      semana = nullif(_dados->>'semana',''),
      empresa_id = nullif(_dados->>'empresa_id','')::uuid,
      representante_id = nullif(_dados->>'representante_id','')::uuid,
      ref_fornecedor = nullif(_dados->>'ref_fornecedor',''),
      composicao = nullif(_dados->>'composicao',''),
      grade_proporcao = coalesce(_dados->'grade_proporcao', grade_proporcao),
      qtd_total = coalesce((_dados->>'qtd_total')::int, qtd_total),
      foto_url = nullif(_dados->>'foto_url',''),
      data_pedido = nullif(_dados->>'data_pedido','')::date,
      data_prevista = nullif(_dados->>'data_prevista','')::date,
      data_entrega = nullif(_dados->>'data_entrega','')::date,
      moeda_compra = coalesce(nullif(_dados->>'moeda_compra',''), moeda_compra),
      moeda_intermediaria = nullif(_dados->>'moeda_intermediaria',''),
      valor_unitario_m1 = coalesce((_dados->>'valor_unitario_m1')::numeric, valor_unitario_m1),
      cotacao_ref = coalesce((_dados->>'cotacao_ref')::numeric, cotacao_ref),
      peso_kg = coalesce((_dados->>'peso_kg')::numeric, peso_kg),
      transporte_m2 = coalesce((_dados->>'transporte_m2')::numeric, transporte_m2),
      desconto_pct = coalesce((_dados->>'desconto_pct')::numeric, desconto_pct),
      cotacao_final = coalesce((_dados->>'cotacao_final')::numeric, cotacao_final),
      markup_atacado = nullif(_dados->>'markup_atacado','')::numeric,
      markup_varejo = nullif(_dados->>'markup_varejo','')::numeric,
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'Produto não encontrado'; end if;
  end if;

  -- Variantes: estado completo (apaga e reinsere pela ordem recebida).
  delete from public.produto_importado_variantes where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_variantes,'[]'::jsonb)) loop
    insert into public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int, 0),
      nullif(rec->>'cor_id','')::uuid, nullif(rec->>'cor_apelido_id','')::uuid,
      coalesce((rec->>'peso')::numeric,0), coalesce((rec->>'qtd')::int,0));
  end loop;

  -- Etapas: estado completo.
  delete from public.produto_importado_etapas where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) loop
    insert into public.produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
      coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
      nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
  end loop;

  perform public._imp_recomputar_precos_modelo(v_id);
  return v_id;
end $$;
revoke execute on function public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;

create or replace function public.salvar_produto_importado(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._salvar_produto_importado_core(_id, _dados, _variantes, _etapas);
end $$;
grant execute on function public.salvar_produto_importado(uuid,jsonb,jsonb,jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- criar_card_produto_importado: cria o modelo espelho (origem='importado').
-- Espelha `_criar_card_produto_acabado_core` (FOR UPDATE, idempotência, REF direta, grade,
-- recompute de preços). Reusa `_pa_grade_variante` (mesmo helper de grade da revenda).
create or replace function public._criar_card_produto_importado_core(_produto_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into p from public.produtos_importados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then raise exception 'Produto não encontrado'; end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id
  ) values (
    v_tenant, p.nome, 'importado', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, null
  ) returning id into v_modelo_id;

  update public.produtos_importados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_importado_variantes where produto_importado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._imp_recomputar_precos_modelo(_produto_id);
  return v_modelo_id;
end $$;
revoke execute on function public._criar_card_produto_importado_core(uuid) from public, anon, authenticated;

create or replace function public.criar_card_produto_importado(_produto_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._criar_card_produto_importado_core(_produto_id);
end $$;
grant execute on function public.criar_card_produto_importado(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- excluir_produto_importado: guarda (bloqueia se tiver OC vinculada — Fase 2).
-- Por ora não há ocs_importado; a guarda fica pronta (checa NADA além de existência).
create or replace function public._excluir_produto_importado_core(_produto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_tenant uuid; v_modelo_id uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  select modelo_id into v_modelo_id from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'Produto não encontrado'; end if;
  -- Fase 2: bloquear se houver OC vinculada. Por ora, exclui (variantes/etapas caem por cascade).
  delete from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  -- o modelo espelho (se houver) vira modelo comum (modelo_id já é on delete set null); NÃO apaga.
end $$;
revoke execute on function public._excluir_produto_importado_core(uuid) from public, anon, authenticated;

create or replace function public.excluir_produto_importado(_produto_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  perform public._excluir_produto_importado_core(_produto_id);
end $$;
grant execute on function public.excluir_produto_importado(uuid) to authenticated;

COMMIT;
