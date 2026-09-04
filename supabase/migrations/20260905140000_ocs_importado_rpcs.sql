-- Produtos Importados — Fase 2: RPCs da OC (ocs_importado) — salvar/receber/excluir.
-- Espelha ESTRUTURALMENTE as RPCs da OC de Produto Acabado/Revenda:
--   _salvar_oc_p_acabado_core(uuid,jsonb,jsonb)   → salvar_oc_importado
--   _receber_oc_p_acabado_core(uuid,jsonb,jsonb)  → receber_oc_importado
--   _excluir_oc_p_acabado_core(uuid)              → excluir_oc_importado
-- Diferenças de domínio (câmbio em vez de prazo/parcelas fixas):
--   - SEM prazo_pagamento/parcelas_entrega — a OC de importado paga por ETAPAS
--     (ocs_importado_etapas, snapshot editável, estado COMPLETO por save — mesmo padrão
--     de _salvar_produto_importado_core, 20260904160000).
--   - Derivados de valor (valor_bruto/valor_total_desconto/valor_unitario_real) espelham a
--     revenda por SIMETRIA de shape (mesmas 3 colunas na tabela), mas aqui são só para
--     exibição — o custo real é o LANDED (`custo_unitario_landed_real`, recalculado por
--     `_imp_recalcular_landed_real_oc` ao final de salvar/receber).
--   - "Fazer pedido" (criação sem _etapas) COPIA o cronograma do card
--     (produto_importado_etapas) para a OC — snapshot; a OC pode divergir depois.
-- Padrão wrapper + _core (REVOKE dos três — invariante #9); gate produto_importado.
-- Idempotente (create or replace); BEGIN/COMMIT.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- salvar_oc_importado: upsert da OC + etapas de pagamento.
-- _dados = escalares da OC (inclui campos de câmbio); _grade = grade_detalhe completa
-- {"<ordem>":{"<tam>":{"pedida":n,"recebida":n,"defeito":n}}}; _etapas = estado completo
-- [{ordem,rotulo,base,percentual,data_vencimento,cotacao}] (delete+reinsere, como o card).
create or replace function public._salvar_oc_importado_core(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario_m1 numeric;
  v_desconto_pct numeric;
  v_bruto numeric;
  v_total_desc numeric;
  v_unit_real numeric;
  v_soma_pedida numeric := 0;
  v_tem_negativo boolean := false;
  v_produto_id uuid;
  v_etapas jsonb;
  v_soma_merc numeric;
  v_soma_frete numeric;
  rec jsonb;
  -- Estado atual da OC (só preenchido quando _id is not null) — guarda de congelamento.
  v_atual_status text;
  v_atual_valor_unitario_m1 numeric;
  v_atual_desconto_pct numeric;
  v_atual_qtd_total int;
  v_atual_grade jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome_produto', '');
  if _id is null then
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
  else
    select status, valor_unitario_m1, desconto_pct, qtd_total, grade_detalhe, produto_importado_id
      into v_atual_status, v_atual_valor_unitario_m1, v_atual_desconto_pct, v_atual_qtd_total, v_atual_grade, v_produto_id
      from public.ocs_importado where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'OC não encontrada';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario_m1 := coalesce(nullif(_dados->>'valor_unitario_m1', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);

  -- Congela ao receber: valor/qtd pedida e a grade "pedida" não mudam mais por este
  -- caminho (recebida/defeito seguem editáveis via receber_oc_importado). NF/revisão/
  -- devolução/anexos/nome/categorias/fornecedor/datas seguem editáveis normalmente.
  if _id is not null and v_atual_status = 'recebido' then
    if v_valor_unitario_m1 is distinct from v_atual_valor_unitario_m1
       or v_desconto_pct is distinct from v_atual_desconto_pct
       or v_qtd_total is distinct from v_atual_qtd_total
       or public._pa_grade_pedida_only(_grade) is distinct from public._pa_grade_pedida_only(v_atual_grade)
    then
      raise exception 'OC recebida — desfaça o recebimento para alterar valores.' using errcode = 'P0001';
    end if;
  end if;

  -- Valida células (nenhuma negativa) e soma da grade "pedida" contra qtd_total.
  select
    coalesce(bool_or(
      coalesce(nullif(t.value->>'pedida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'recebida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'defeito', '')::numeric, 0) < 0
    ), false),
    coalesce(sum(coalesce(nullif(t.value->>'pedida', '')::numeric, 0)), 0)
  into v_tem_negativo, v_soma_pedida
  from jsonb_each(coalesce(_grade, '{}'::jsonb)) o
  cross join lateral jsonb_each(o.value) t;

  if v_tem_negativo then
    raise exception 'As quantidades da grade não podem ser negativas.' using errcode = 'P0001';
  end if;
  if v_qtd_total > 0 and v_soma_pedida <> v_qtd_total then
    raise exception 'A soma da grade pedida (%) difere da quantidade total (%)', v_soma_pedida, v_qtd_total
      using errcode = 'P0001';
  end if;

  -- Derivados (só exibição — o custo real é o landed, recalculado no final).
  v_bruto := v_qtd_total * v_valor_unitario_m1;
  v_total_desc := v_bruto * (1 - v_desconto_pct / 100);
  v_unit_real := case when v_qtd_total > 0 then v_total_desc / v_qtd_total else 0 end;

  if _id is null then
    v_produto_id := nullif(_dados->>'produto_importado_id', '')::uuid;
    if v_produto_id is not null then
      perform 1 from public.produtos_importados where id = v_produto_id and tenant_id = v_tenant;
      if not found then
        raise exception 'Produto não encontrado';
      end if;
    end if;

    insert into public.ocs_importado (
      tenant_id, produto_importado_id, numero, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      empresa_id, representante_id, ref_fornecedor, composicao,
      data_pedido, data_prevista, data_entrega,
      grade_proporcao, grade_detalhe, variantes,
      qtd_total, valor_bruto, valor_total_desconto, valor_unitario_real,
      nota_fiscal, responsavel_recebimento_id, devolucao, revisao,
      anexo_pedido_url, anexo_nf_url,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final
    ) values (
      v_tenant, v_produto_id, nullif(_dados->>'numero', ''), v_nome, nullif(_dados->>'grupo_id', '')::uuid, nullif(_dados->>'categoria_id', '')::uuid,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(nullif(_dados->>'data_pedido', '')::date, current_date),
      nullif(_dados->>'data_prevista', '')::date, nullif(_dados->>'data_entrega', '')::date,
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), coalesce(_grade, '{}'::jsonb), coalesce(_dados->'variantes', '[]'::jsonb),
      v_qtd_total, v_bruto, v_total_desc, v_unit_real,
      _dados->>'nota_fiscal', nullif(_dados->>'responsavel_recebimento_id', '')::uuid, _dados->>'devolucao', _dados->>'revisao',
      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url',
      coalesce(nullif(_dados->>'moeda_compra', ''), 'RMB'), nullif(_dados->>'moeda_intermediaria', ''),
      v_valor_unitario_m1, coalesce(nullif(_dados->>'cotacao_ref', '')::numeric, 0),
      coalesce(nullif(_dados->>'peso_kg', '')::numeric, 0), coalesce(nullif(_dados->>'transporte_m2', '')::numeric, 0),
      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0)
    ) returning id into v_id;

    -- "Fazer pedido": se _etapas não veio (vazio/null) e há produto vinculado, copia o
    -- cronograma do CARD (snapshot — a OC pode divergir depois). Se _etapas veio
    -- preenchido, usa ele (ramo comum abaixo).
    if (_etapas is null or jsonb_array_length(_etapas) = 0) and v_produto_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'ordem', e.ordem, 'rotulo', e.rotulo, 'base', e.base,
        'percentual', e.percentual, 'data_vencimento', e.data_vencimento, 'cotacao', e.cotacao
      ) order by e.ordem), '[]'::jsonb)
      into v_etapas
      from public.produto_importado_etapas e
      where e.produto_importado_id = v_produto_id;
    else
      v_etapas := coalesce(_etapas, '[]'::jsonb);
    end if;
  else
    update public.ocs_importado set
      numero = coalesce(nullif(_dados->>'numero', ''), numero),
      nome_produto = coalesce(v_nome, nome_produto),
      grupo_id = nullif(_dados->>'grupo_id', '')::uuid,
      categoria_id = nullif(_dados->>'categoria_id', '')::uuid,
      subcategoria1_id = nullif(_dados->>'subcategoria1_id', '')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id', '')::uuid,
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      data_pedido = coalesce(nullif(_dados->>'data_pedido', '')::date, data_pedido),
      data_prevista = nullif(_dados->>'data_prevista', '')::date,
      data_entrega = nullif(_dados->>'data_entrega', '')::date,
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      grade_detalhe = coalesce(_grade, '{}'::jsonb),
      variantes = coalesce(_dados->'variantes', '[]'::jsonb),
      qtd_total = v_qtd_total,
      valor_bruto = v_bruto,
      valor_total_desconto = v_total_desc,
      valor_unitario_real = v_unit_real,
      nota_fiscal = _dados->>'nota_fiscal',
      responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
      devolucao = _dados->>'devolucao',
      revisao = _dados->>'revisao',
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      anexo_nf_url = _dados->>'anexo_nf_url',
      moeda_compra = coalesce(nullif(_dados->>'moeda_compra', ''), moeda_compra),
      moeda_intermediaria = nullif(_dados->>'moeda_intermediaria', ''),
      valor_unitario_m1 = v_valor_unitario_m1,
      cotacao_ref = coalesce(nullif(_dados->>'cotacao_ref', '')::numeric, 0),
      peso_kg = coalesce(nullif(_dados->>'peso_kg', '')::numeric, 0),
      transporte_m2 = coalesce(nullif(_dados->>'transporte_m2', '')::numeric, 0),
      desconto_pct = v_desconto_pct,
      cotacao_final = coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0),
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
    v_etapas := coalesce(_etapas, '[]'::jsonb);
  end if;

  -- Etapas: estado completo (delete+reinsere, como _salvar_produto_importado_core).
  -- Valida Σ%=100 por base (só quando há etapas daquela base).
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_merc
    from jsonb_array_elements(v_etapas) e where e->>'base' = 'mercadoria';
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_frete
    from jsonb_array_elements(v_etapas) e where e->>'base' = 'frete';
  if exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='mercadoria') and round(v_soma_merc,2) <> 100 then
    raise exception 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='frete') and round(v_soma_frete,2) <> 100 then
    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';
  end if;

  delete from public.ocs_importado_etapas where oc_importado_id = v_id;
  for rec in select * from jsonb_array_elements(v_etapas) loop
    insert into public.ocs_importado_etapas (tenant_id, oc_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
      coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
      nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
  end loop;

  perform public._imp_recalcular_landed_real_oc(v_id);
  return v_id;
end $$;
revoke execute on function public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;

create or replace function public.salvar_oc_importado(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._salvar_oc_importado_core(_id, _dados, _grade, _etapas);
end $$;
grant execute on function public.salvar_oc_importado(uuid,jsonb,jsonb,jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- receber_oc_importado: espelha _receber_oc_p_acabado_core linha a linha, trocando
-- ocs_p_acabado→ocs_importado, produtos_acabados→produtos_importados,
-- produto_acabado_id→produto_importado_id, produto_acabado_variantes→produto_importado_variantes.
-- Materializa cad BARE + cad_grades (planejadas=pedida, reais=max(0,recebida−defeito)) +
-- controle_qualidade pendente (só se não existir). status='recebido'.
create or replace function public._receber_oc_importado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid;
  v_oc record;
  v_produto record;
  v_cad_id uuid;
  v_grade_final jsonb;
  rec record;
  tam_rec record;
  v_var_grade jsonb;
  v_planejadas jsonb;
  v_reais jsonb;
  v_tot_plan int;
  v_tot_real int;
  v_grand_total int := 0;
  v_pedida numeric;
  v_recebida numeric;
  v_defeito numeric;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into v_oc from public.ocs_importado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'OC não encontrada';
  end if;

  if v_oc.produto_importado_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  select * into v_produto from public.produtos_importados
    where id = v_oc.produto_importado_id and tenant_id = v_tenant;
  if not found or v_produto.modelo_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  v_grade_final := coalesce(_grade, v_oc.grade_detalhe, '{}'::jsonb);

  update public.ocs_importado set
    data_entrega = nullif(_dados->>'data_entrega', '')::date,
    nota_fiscal = _dados->>'nota_fiscal',
    responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
    devolucao = _dados->>'devolucao',
    revisao = _dados->>'revisao',
    grade_detalhe = v_grade_final,
    status = 'recebido',
    updated_at = now()
  where id = _oc_id;

  -- upsert cad (1 por modelo — trigger enforce_unique_fk('modelo_id') garante a
  -- invariante; aqui só evitamos o INSERT redundante quando já existe).
  select id into v_cad_id from public.cad where modelo_id = v_produto.modelo_id and tenant_id = v_tenant;
  if v_cad_id is null then
    insert into public.cad (tenant_id, modelo_id) values (v_tenant, v_produto.modelo_id)
      returning id into v_cad_id;
  end if;

  -- upsert cad_grades por variante: variante_numero = ordem; grades_planejadas = pedida
  -- por tamanho; grades_reais = max(0, recebida−defeito) por tamanho.
  for rec in
    select ordem from public.produto_importado_variantes
    where produto_importado_id = v_produto.id
    order by ordem
  loop
    v_var_grade := coalesce(v_grade_final -> rec.ordem::text, '{}'::jsonb);
    v_planejadas := '{}'::jsonb;
    v_reais := '{}'::jsonb;
    v_tot_plan := 0;
    v_tot_real := 0;

    for tam_rec in select key, value from jsonb_each(v_var_grade) loop
      v_pedida := coalesce(nullif(tam_rec.value->>'pedida', '')::numeric, 0);
      v_recebida := coalesce(nullif(tam_rec.value->>'recebida', '')::numeric, 0);
      v_defeito := coalesce(nullif(tam_rec.value->>'defeito', '')::numeric, 0);

      v_planejadas := v_planejadas || jsonb_build_object(tam_rec.key, v_pedida::int);
      v_reais := v_reais || jsonb_build_object(tam_rec.key, greatest(0, v_recebida - v_defeito)::int);
      v_tot_plan := v_tot_plan + v_pedida::int;
      v_tot_real := v_tot_real + greatest(0, v_recebida - v_defeito)::int;
    end loop;

    insert into public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
    values (v_cad_id, rec.ordem, v_planejadas, v_reais, v_tot_plan, v_tot_real)
    on conflict (cad_id, variante_numero) do update set
      grades_planejadas = excluded.grades_planejadas,
      grades_reais = excluded.grades_reais,
      grade_total_planejada = excluded.grade_total_planejada,
      grade_total_real = excluded.grade_total_real;

    v_grand_total := v_grand_total + v_tot_real;
  end loop;

  -- upsert controle_qualidade: mantém 'pendente' (default da coluna) se não existe;
  -- se já existe (inclusive 'confirmado'), NÃO toca — o cad_grades acima já regravou
  -- grades_reais e o trigger trg_rebaixa_direcionamento_grade (AFTER UPDATE OF
  -- grades_reais ON cad_grades) cuida da rebaixa do Direcionamento sozinho.
  if not exists (select 1 from public.controle_qualidade where cad_id = v_cad_id) then
    insert into public.controle_qualidade (cad_id, tenant_id, status) values (v_cad_id, v_tenant, 'pendente');
  end if;

  -- Custo real chegou — recalcula o landed real da OC a partir das etapas.
  perform public._imp_recalcular_landed_real_oc(_oc_id);

  return jsonb_build_object('cad_id', v_cad_id, 'total_real', v_grand_total);
end $$;
revoke execute on function public._receber_oc_importado_core(uuid,jsonb,jsonb) from public, anon, authenticated;

create or replace function public.receber_oc_importado(_oc_id uuid, _dados jsonb, _grade jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._receber_oc_importado_core(_oc_id, _dados, _grade);
end $$;
grant execute on function public.receber_oc_importado(uuid,jsonb,jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- excluir_oc_importado: espelha _excluir_oc_p_acabado_core (guarda recebido/parcela paga).
-- ⚠️ Assume que `parcelas.oc_importado_id` já existe (será criada por migration seguinte —
-- ver cabeçalho/dúvidas na entrega). Sem essa coluna, esta função falha ao compilar.
create or replace function public._excluir_oc_importado_core(_oc_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_tenant uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select status into v_status from public.ocs_importado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'OC não encontrada.' using errcode = 'P0002';
  end if;

  if v_status = 'recebido' then
    raise exception 'Não é possível excluir: OC já recebida (materializou CAD/CQ). Estorne o recebimento antes.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.parcelas where oc_importado_id = _oc_id and status = 'pago') then
    raise exception 'Não é possível excluir: a OC tem parcela paga no financeiro.' using errcode = 'P0001';
  end if;

  -- Parcelas NÃO pagas somem via ON DELETE CASCADE (oc_importado_id); a paga já foi
  -- barrada acima. Etapas somem via ON DELETE CASCADE (ocs_importado_etapas.oc_importado_id).
  delete from public.ocs_importado where id = _oc_id and tenant_id = v_tenant;
end $$;
revoke execute on function public._excluir_oc_importado_core(uuid) from public, anon, authenticated;

create or replace function public.excluir_oc_importado(_oc_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  perform public._excluir_oc_importado_core(_oc_id);
end $$;
grant execute on function public.excluir_oc_importado(uuid) to authenticated;

COMMIT;
