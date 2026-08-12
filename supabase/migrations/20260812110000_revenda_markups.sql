-- Produto Acabado (Revenda) — Markups digitáveis (decisão do dono, ago/2026): a cadeia de
-- preço da revenda passa a ser
--   custo total da peça (valor unitário real + insumos) × markup_atacado = PREÇO ATACADO
--   preço atacado × markup_varejo = PREÇO VAREJO
-- Os 2 markups são DIGITÁVEIS em `produtos_acabados` (mesma fonte, lida/gravada nas DUAS
-- telas — card do Produto Acabado E card revenda do Planejamento); `modelos.preco_atacado`/
-- `preco_venda` do espelho viram DERIVADOS (recomputados+persistidos no servidor, nunca mais
-- digitados pra revenda — MANUFATURADOS intocados, `preco.ts` intocado).
--
-- custo = valor_unitario × (1 − desconto_pct/100) + insumos_por_peça — MESMA base do ramo
-- revenda do `_custo_unitario_modelos_core.previsto` (lido VIVO antes de escrever este
-- arquivo — `pa.valor_unitario * (1 - pa.desconto_pct/100.0) + pa.insumos_por_peca`, com
-- `insumos_por_peca = sum(me.consumo * me.custo_previsto)`), então o preview "previsto" do
-- Planejamento e o preço derivado gravado aqui usam sempre o MESMO número.
--
-- Todas as reescritas de `_core` abaixo são idênticas à definição VIVA (pg_get_functiondef,
-- conferido antes de editar) + só o trecho novo descrito em cada bloco — nenhuma outra
-- cláusula tocada.

-- ======================================================================
-- Coluna nova — null = "não definido" (placeholder na UI; recompute não mexe no preço).
-- ======================================================================
alter table public.produtos_acabados
  add column if not exists markup_atacado numeric(8,3),
  add column if not exists markup_varejo numeric(8,3);

-- ======================================================================
-- Helper interno — recomputa e persiste modelos.preco_atacado/preco_venda do espelho de
-- UM produto, a partir do custo atual (valor_unitario/desconto_pct/insumos) × os markups
-- do próprio produto. Sem espelho (modelo_id null) → no-op. Markup null → aquele preço
-- específico NÃO é tocado (mantém o que já estava — "sem markups (null) → preços não são
-- tocados"); atacado recém-computado alimenta o varejo na MESMA chamada quando os dois
-- markups estão presentes. Guard `IS DISTINCT FROM` no UPDATE final: evita bumpar
-- `modelos.rev` (trigger `trg_colab_rev`, incondicional em toda UPDATE que CASA a linha)
-- quando o preço recomputado é IGUAL ao que já estava — sem isso, um recompute disparado
-- por um save de OC que não muda o preço (ex.: mesmo valor_unitario) forjaria um P0409
-- pra quem estiver editando o card do modelo ao mesmo tempo (mesmo espírito do guard de
-- `fn_modelo_servico_mo_rollup`, invariante #8).
-- ======================================================================
create or replace function public._pa_recomputar_precos_modelo(_produto_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_modelo_id uuid;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_insumos numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo
    into v_modelo_id, v_valor_unitario, v_desconto_pct, v_markup_atacado, v_markup_varejo
    from public.produtos_acabados p where p.id = _produto_id;

  if v_modelo_id is null then
    return; -- sem espelho no Planejamento ainda — nada a recomputar
  end if;

  select coalesce(sum(me.consumo * me.custo_previsto), 0) into v_insumos
    from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;

  v_custo := coalesce(v_valor_unitario, 0) * (1 - coalesce(v_desconto_pct, 0) / 100.0) + v_insumos;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  v_preco_atacado := case when v_markup_atacado is not null
    then round(v_custo * v_markup_atacado, 2)
    else v_atacado_atual end;
  v_preco_venda := case when v_preco_atacado is not null and v_markup_varejo is not null
    then round(v_preco_atacado * v_markup_varejo, 2)
    else v_venda_atual end;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end;
$function$;

revoke execute on function public._pa_recomputar_precos_modelo(uuid) from public, anon, authenticated;

-- ======================================================================
-- _salvar_produto_acabado_core — aceita markup_atacado/markup_varejo em `_dados`, persiste
-- e recomputa o espelho no final (idêntico ao vivo + os 3 trechos marcados abaixo).
-- ======================================================================
create or replace function public._salvar_produto_acabado_core(_id uuid, _dados jsonb, _variantes jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_id uuid;
  v_modelo_id uuid;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_insumos numeric := 0;
  v_redistribuir boolean;
  v_soma_var int := 0;
  v_pesos jsonb := '{}'::jsonb;
  v_split jsonb := '{}'::jsonb;
  v_variantes_final jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome', '');
  v_grupo_id := nullif(_dados->>'grupo_id', '')::uuid;
  v_categoria_id := nullif(_dados->>'categoria_id', '')::uuid;

  if _id is null then
    -- Pendência herdada do review da Task 1: sem grupo+categoria a REF automática sai parcial.
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    v_modelo_id := null;
  else
    select modelo_id into v_modelo_id from public.produtos_acabados
      where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'Produto não encontrado';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);
  v_redistribuir := coalesce(_dados->>'redistribuir', 'false') = 'true';

  -- Markups digitáveis (novo) — null = "não definido"; > 0 obrigatório quando presente
  -- (markup ≤ 0 zeraria/inverteria o preço derivado em silêncio).
  v_markup_atacado := nullif(_dados->>'markup_atacado', '')::numeric;
  v_markup_varejo := nullif(_dados->>'markup_varejo', '')::numeric;
  if (v_markup_atacado is not null and v_markup_atacado <= 0)
     or (v_markup_varejo is not null and v_markup_varejo <= 0) then
    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  -- pesos por ordem (chave = ordem em texto, casa com o retorno de _split_maior_resto)
  select coalesce(jsonb_object_agg(v->>'ordem', coalesce(nullif(v->>'peso', '')::numeric, 0)), '{}'::jsonb)
    into v_pesos
    from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) v;

  if v_redistribuir then
    v_split := public._split_maior_resto(v_qtd_total, v_pesos);
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'ordem', (v->>'ordem')::int,
      'cor_id', nullif(v->>'cor_id', ''),
      'cor_apelido_id', nullif(v->>'cor_apelido_id', ''),
      'peso', coalesce(nullif(v->>'peso', '')::numeric, 0),
      'qtd', case when v_redistribuir
                  then coalesce((v_split->>(v->>'ordem'))::int, 0)
                  else coalesce(nullif(v->>'qtd', '')::int, 0)
             end
    )), '[]'::jsonb),
    coalesce(sum(case when v_redistribuir
                       then coalesce((v_split->>(v->>'ordem'))::int, 0)
                       else coalesce(nullif(v->>'qtd', '')::int, 0)
                  end), 0)
  into v_variantes_final, v_soma_var
  from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) v;

  if not v_redistribuir and v_soma_var <> v_qtd_total then
    raise exception 'A soma das variantes (%) difere da quantidade total (%)', v_soma_var, v_qtd_total
      using errcode = 'P0001';
  end if;

  if v_modelo_id is not null then
    select coalesce(sum(me.custo_previsto * me.consumo), 0) into v_insumos
      from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;
  end if;

  if _id is null then
    insert into public.produtos_acabados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total,
      markup_atacado, markup_varejo
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos,
      v_markup_atacado, v_markup_varejo
    ) returning id into v_id;
  else
    update public.produtos_acabados set
      nome = coalesce(v_nome, nome),
      ref = coalesce(nullif(_dados->>'ref', ''), ref),
      grupo_id = v_grupo_id,
      categoria_id = v_categoria_id,
      subcategoria1_id = nullif(_dados->>'subcategoria1_id', '')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id', '')::uuid,
      colecao_id = nullif(_dados->>'colecao_id', '')::uuid,
      subcolecao = _dados->>'subcolecao',
      semana = _dados->>'semana',
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      qtd_total = v_qtd_total,
      valor_unitario = v_valor_unitario,
      desconto_pct = v_desconto_pct,
      insumos_total = v_insumos,
      markup_atacado = v_markup_atacado,
      markup_varejo = v_markup_varejo,
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
  end if;

  delete from public.produto_acabado_variantes where produto_acabado_id = v_id;
  insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
  select v_tenant, v_id,
         (elem->>'ordem')::int,
         nullif(elem->>'cor_id', '')::uuid,
         nullif(elem->>'cor_apelido_id', '')::uuid,
         coalesce((elem->>'peso')::numeric, 0),
         coalesce((elem->>'qtd')::int, 0)
  from jsonb_array_elements(v_variantes_final) elem;

  -- Novo: custo (valor_unitario/desconto/insumos) pode ter mudado neste save — recomputa e
  -- persiste preco_atacado/preco_venda do espelho (no-op se ainda não há modelo_id).
  perform public._pa_recomputar_precos_modelo(v_id);

  return v_id;
end;
$$;

-- ======================================================================
-- _criar_card_produto_acabado_core — idêntico ao vivo + 1 linha: o produto pode já ter
-- markup configurado ANTES de ganhar o card (markup vive em produtos_acabados, independente
-- do espelho existir) — no instante em que modelo_id passa a existir, computa o preço já
-- na criação em vez de esperar o próximo save do produto.
-- ======================================================================
create or replace function public._criar_card_produto_acabado_core(_produto_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- FOR UPDATE: trava a linha até o fim da função — duplo-clique/chamada concorrente
  -- bloqueia na 2ª chamada até a 1ª terminar (INSERT do modelo + UPDATE modelo_id),
  -- daí vê modelo_id já preenchido e cai no RAISE de idempotência normalmente, em vez
  -- de correr e criar 2 espelhos.
  select * into p from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Produto não encontrado';
  end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  -- Espelho: tenant_id explícito (não confiar no set_tenant_id_trg — o INSERT roda dentro
  -- de uma função SECURITY DEFINER, então basta o valor já resolvido em v_tenant acima).
  -- ref copiada DIRETO do produto: revenda não passa pelo fluxo aprovar/ref_auto do modelo.
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id
  ) values (
    v_tenant, p.nome, 'revenda', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, null
  ) returning id into v_modelo_id;

  update public.produtos_acabados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._pa_recomputar_precos_modelo(_produto_id);

  return v_modelo_id;
end;
$$;

-- ======================================================================
-- _salvar_oc_p_acabado_core — idêntico ao vivo (pós 20260812100000, com o sync Compra→
-- Produto) + 1 linha: depois de empurrar valor_unitario/desconto_pct pro produto (custo
-- mudou), recomputa os preços derivados do espelho.
-- ======================================================================
create or replace function public._salvar_oc_p_acabado_core(_id uuid, _dados jsonb, _grade jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_bruto numeric;
  v_total_desc numeric;
  v_unit_real numeric;
  v_soma_pedida numeric := 0;
  v_tem_negativo boolean := false;
  v_produto_id uuid;
  -- Estado atual da OC (só preenchido quando _id is not null) — usado pela guarda de
  -- congelamento de preço (item 4) e agora também alimenta v_produto_id no ramo UPDATE
  -- (sync Compra→Produto abaixo).
  v_atual_status text;
  v_atual_valor_unitario numeric;
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
    select status, valor_unitario, desconto_pct, qtd_total, grade_detalhe, produto_acabado_id
      into v_atual_status, v_atual_valor_unitario, v_atual_desconto_pct, v_atual_qtd_total, v_atual_grade, v_produto_id
      from public.ocs_p_acabado where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'OC não encontrada';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);

  -- Item 4: OC já recebida — valor unitário/desconto/qtd pedida e a grade "pedida" não
  -- mudam mais por este caminho (recebida/defeito continuam editáveis via
  -- receber_oc_p_acabado). NF/revisão/devolução/anexos/nome/categorias/fornecedor/datas/
  -- prazo seguem editáveis normalmente — a guarda é só sobre os 4 campos abaixo.
  if _id is not null and v_atual_status = 'recebido' then
    if v_valor_unitario is distinct from v_atual_valor_unitario
       or v_desconto_pct is distinct from v_atual_desconto_pct
       or v_qtd_total is distinct from v_atual_qtd_total
       or public._pa_grade_pedida_only(_grade) is distinct from public._pa_grade_pedida_only(v_atual_grade)
    then
      raise exception 'OC recebida — desfaça o recebimento para alterar valores.' using errcode = 'P0001';
    end if;
  end if;

  -- valida células (nenhuma negativa) e soma da grade "pedida" contra qtd_total
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

  v_bruto := v_qtd_total * v_valor_unitario;
  v_total_desc := v_bruto * (1 - v_desconto_pct / 100);
  v_unit_real := case when v_qtd_total > 0 then v_total_desc / v_qtd_total else 0 end;

  if _id is null then
    v_produto_id := nullif(_dados->>'produto_acabado_id', '')::uuid;
    if v_produto_id is not null then
      perform 1 from public.produtos_acabados where id = v_produto_id and tenant_id = v_tenant;
      if not found then
        raise exception 'Produto não encontrado';
      end if;
    end if;

    insert into public.ocs_p_acabado (
      tenant_id, produto_acabado_id, numero, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      empresa_id, representante_id, ref_fornecedor, composicao,
      data_pedido, data_prevista, data_entrega, prazo_pagamento, parcelas_entrega,
      grade_proporcao, grade_detalhe, variantes,
      qtd_total, valor_unitario, desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real,
      nota_fiscal, responsavel_recebimento_id, devolucao, revisao,
      anexo_pedido_url, anexo_nf_url
    ) values (
      v_tenant, v_produto_id, nullif(_dados->>'numero', ''), v_nome, nullif(_dados->>'grupo_id', '')::uuid, nullif(_dados->>'categoria_id', '')::uuid,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(nullif(_dados->>'data_pedido', '')::date, current_date),
      nullif(_dados->>'data_prevista', '')::date, nullif(_dados->>'data_entrega', '')::date,
      coalesce(nullif(_dados->>'prazo_pagamento', ''), '30'),
      coalesce(nullif(_dados->>'parcelas_entrega', '')::int, 1),
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), coalesce(_grade, '{}'::jsonb), coalesce(_dados->'variantes', '[]'::jsonb),
      v_qtd_total, v_valor_unitario, v_desconto_pct, v_bruto, v_total_desc, v_unit_real,
      _dados->>'nota_fiscal', nullif(_dados->>'responsavel_recebimento_id', '')::uuid, _dados->>'devolucao', _dados->>'revisao',
      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url'
    ) returning id into v_id;
  else
    update public.ocs_p_acabado set
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
      prazo_pagamento = coalesce(nullif(_dados->>'prazo_pagamento', ''), prazo_pagamento),
      parcelas_entrega = coalesce(nullif(_dados->>'parcelas_entrega', '')::int, parcelas_entrega),
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      grade_detalhe = coalesce(_grade, '{}'::jsonb),
      variantes = coalesce(_dados->'variantes', '[]'::jsonb),
      qtd_total = v_qtd_total,
      valor_unitario = v_valor_unitario,
      desconto_pct = v_desconto_pct,
      valor_bruto = v_bruto,
      valor_total_desconto = v_total_desc,
      valor_unitario_real = v_unit_real,
      nota_fiscal = _dados->>'nota_fiscal',
      responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
      devolucao = _dados->>'devolucao',
      revisao = _dados->>'revisao',
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      anexo_nf_url = _dados->>'anexo_nf_url',
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
  end if;

  -- Sync Compra→Produto: OC com produto vinculado empurra valor_unitario/desconto_pct pro
  -- card do produto — ver decisão sobre qtd_total na migração 20260812100000. OC avulsa
  -- (v_produto_id null) não toca em nada.
  if v_produto_id is not null then
    update public.produtos_acabados
      set valor_unitario = v_valor_unitario, desconto_pct = v_desconto_pct, updated_at = now()
      where id = v_produto_id and tenant_id = v_tenant;

    -- Novo: custo mudou (valor_unitario/desconto_pct sincronizados acima) — recomputa e
    -- persiste os preços derivados (markup atacado/varejo) do espelho.
    perform public._pa_recomputar_precos_modelo(v_produto_id);
  end if;

  return v_id;
end;
$function$;

-- ======================================================================
-- _vincular_oc_p_acabado_core — idêntico ao vivo + 1 linha: ao VINCULAR (custo herdado da
-- OC), recomputa os preços derivados do espelho.
-- ======================================================================
create or replace function public._vincular_oc_p_acabado_core(_oc_id uuid, _produto_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select exists(select 1 from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant) into v_ok;
  if not v_ok then
    raise exception 'OC não encontrada';
  end if;

  if _produto_id is not null then
    select exists(select 1 from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant) into v_ok;
    if not v_ok then
      raise exception 'Produto não encontrado';
    end if;
  end if;

  -- NULL desvincula; a trigger enforce_oc_pa_vinculo_unico cobre "1 OC ativa por produto".
  update public.ocs_p_acabado set produto_acabado_id = _produto_id, updated_at = now()
    where id = _oc_id and tenant_id = v_tenant;

  -- Sync Compra→Produto: ao VINCULAR (não ao desvincular), o produto herda
  -- valor_unitario/desconto_pct da OC na hora — mesmo espírito de `_salvar_oc_p_acabado_
  -- core` acima, pra não deixar o card mostrando o valor antigo até o próximo save da OC.
  if _produto_id is not null then
    update public.produtos_acabados set
      valor_unitario = (select oc.valor_unitario from public.ocs_p_acabado oc where oc.id = _oc_id),
      desconto_pct = (select oc.desconto_pct from public.ocs_p_acabado oc where oc.id = _oc_id),
      updated_at = now()
    where id = _produto_id and tenant_id = v_tenant;

    -- Novo: custo mudou — recomputa e persiste os preços derivados do espelho.
    perform public._pa_recomputar_precos_modelo(_produto_id);
  end if;
end;
$function$;

-- ======================================================================
-- _receber_oc_p_acabado_core — idêntico ao vivo + 1 linha: custo real chegou (paridade
-- defensiva — na prática valor_unitario/desconto_pct já estão congelados desde o pedido,
-- então o previsto normalmente já bate; cobre o caso de insumos terem mudado entre o
-- pedido e o recebimento).
-- ======================================================================
create or replace function public._receber_oc_p_acabado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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

  select * into v_oc from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'OC não encontrada';
  end if;

  if v_oc.produto_acabado_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  select * into v_produto from public.produtos_acabados
    where id = v_oc.produto_acabado_id and tenant_id = v_tenant;
  if not found or v_produto.modelo_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  v_grade_final := coalesce(_grade, v_oc.grade_detalhe, '{}'::jsonb);

  update public.ocs_p_acabado set
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
    select ordem from public.produto_acabado_variantes
    where produto_acabado_id = v_produto.id
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

  -- Novo: custo real chegou — recomputa e persiste os preços derivados do espelho
  -- (defensivo/paridade; ver comentário no cabeçalho da migração).
  perform public._pa_recomputar_precos_modelo(v_produto.id);

  return jsonb_build_object('cad_id', v_cad_id, 'total_real', v_grand_total);
end;
$$;

-- ======================================================================
-- salvar_markups_produto_acabado — RPC pequena e focada (mesmo padrão de
-- vincular_oc_p_acabado): grava SÓ os 2 markups sem tocar no resto do produto — usada pelo
-- card revenda do Planejamento, que não tem (e não deveria montar) o payload COMPLETO de
-- `salvar_produto_acabado` (esse sim usado pelo planejador Produto Acabado, que já manda o
-- estado inteiro a cada save). Sem isto, um save parcial pela tela de Planejamento via
-- `salvar_produto_acabado` apagaria silenciosamente grupo/categoria/fornecedor/variantes
-- etc. (esses campos não são coalescidos com o valor atual nessa RPC).
-- ======================================================================
create or replace function public._salvar_markups_produto_acabado_core(_produto_id uuid, _markup_atacado numeric, _markup_varejo numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  if (_markup_atacado is not null and _markup_atacado <= 0)
     or (_markup_varejo is not null and _markup_varejo <= 0) then
    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  update public.produtos_acabados
    set markup_atacado = _markup_atacado, markup_varejo = _markup_varejo, updated_at = now()
    where id = _produto_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Produto não encontrado';
  end if;

  perform public._pa_recomputar_precos_modelo(_produto_id);
end;
$function$;

create or replace function public.salvar_markups_produto_acabado(_produto_id uuid, _markup_atacado numeric, _markup_varejo numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._salvar_markups_produto_acabado_core(_produto_id, _markup_atacado, _markup_varejo);
end;
$function$;

-- ======================================================================
-- REVOKEs (invariante #9: dos TRÊS no _core; PUBLIC+anon no wrapper) ------
-- ======================================================================
revoke execute on function public._pa_recomputar_precos_modelo(uuid) from public, anon, authenticated;
revoke execute on function public._salvar_produto_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public._criar_card_produto_acabado_core(uuid) from public, anon, authenticated;
revoke execute on function public._salvar_oc_p_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public._vincular_oc_p_acabado_core(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._receber_oc_p_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public._salvar_markups_produto_acabado_core(uuid, numeric, numeric) from public, anon, authenticated;

revoke execute on function public.salvar_markups_produto_acabado(uuid, numeric, numeric) from public, anon;
grant execute on function public.salvar_markups_produto_acabado(uuid, numeric, numeric) to authenticated;
