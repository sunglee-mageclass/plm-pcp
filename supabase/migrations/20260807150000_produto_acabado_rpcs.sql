-- Produto Acabado (Revenda) — Task 2/8: RPCs de escrita (salvar produto, criar card,
-- aplicar ao modelo, vincular OC, salvar OC) + helper de distribuição por maior resto.
-- Idempotente (CREATE OR REPLACE / nomes novos) — sem overload, não precisa DROP+BEGIN/COMMIT.

-- ======================================================================
-- Helpers -------------------------------------------------------------
-- ======================================================================

-- Distribui _total inteiro entre as chaves de _pesos ({"k":peso}) proporcional ao peso,
-- método do maior resto (Hamilton): base = floor(total*peso/Σpeso); o resto (total - Σbase)
-- é distribuído 1 a 1 pelas chaves com maior fração, desempate por chave (ordem alfabética).
-- Chaves com peso<=0 (ou Σpeso=0) ficam com 0. Retorna todas as chaves de _pesos.
create or replace function public._split_maior_resto(_total int, _pesos jsonb)
returns jsonb
language sql
immutable
as $$
  with pesos as (
    select key, (value)::numeric as peso
    from jsonb_each_text(coalesce(_pesos, '{}'::jsonb))
  ),
  soma as (
    select coalesce(sum(peso) filter (where peso > 0), 0) as total_peso from pesos
  ),
  base as (
    select p.key, p.peso,
      case when s.total_peso > 0 and p.peso > 0
        then floor(coalesce(_total, 0) * p.peso / s.total_peso)
        else 0 end as qtd_base,
      case when s.total_peso > 0 and p.peso > 0
        then (coalesce(_total, 0) * p.peso / s.total_peso) - floor(coalesce(_total, 0) * p.peso / s.total_peso)
        else 0 end as frac
    from pesos p cross join soma s
  ),
  falta as (
    select (coalesce(_total, 0) - coalesce(sum(qtd_base), 0))::int as resto from base
  ),
  ranked as (
    select b.*, row_number() over (order by b.frac desc, b.key asc) as rn
    from base b
  )
  select coalesce(jsonb_object_agg(r.key, (r.qtd_base + case when r.rn <= f.resto then 1 else 0 end)::int), '{}'::jsonb)
  from ranked r cross join falta f;
$$;

-- Grade de uma variante (por qtd de peça daquela cor): grupo Acessórios = grade única
-- {"UN": qtd}; demais = split por tamanho (grade_proporcao do produto, maior resto).
create or replace function public._pa_grade_variante(_grupo_id uuid, _grade_proporcao jsonb, _qtd int)
returns jsonb
language plpgsql
stable
as $$
begin
  if public._grupo_eh_acessorio(_grupo_id) then
    return jsonb_build_object('UN', coalesce(_qtd, 0));
  end if;
  return public._split_maior_resto(coalesce(_qtd, 0), coalesce(_grade_proporcao, '{}'::jsonb));
end;
$$;

revoke execute on function public._split_maior_resto(int, jsonb) from public, anon, authenticated;
revoke execute on function public._pa_grade_variante(uuid, jsonb, int) from public, anon, authenticated;

-- ======================================================================
-- salvar_produto_acabado ------------------------------------------------
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
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos
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

  return v_id;
end;
$$;

create or replace function public.salvar_produto_acabado(_id uuid, _dados jsonb, _variantes jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._salvar_produto_acabado_core(_id, _dados, _variantes);
end;
$$;

-- ======================================================================
-- criar_card_produto_acabado -------------------------------------------
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

  select * into p from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
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

  return v_modelo_id;
end;
$$;

create or replace function public.criar_card_produto_acabado(_produto_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._criar_card_produto_acabado_core(_produto_id);
end;
$$;

-- ======================================================================
-- aplicar_produto_ao_modelo ----------------------------------------------
-- ======================================================================
create or replace function public._aplicar_produto_ao_modelo_core(_produto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  p record;
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

  select * into p from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Produto não encontrado';
  end if;
  if p.modelo_id is null then
    raise exception 'Este produto ainda não tem card no Planejamento — crie o card antes de aplicar.'
      using errcode = 'P0001';
  end if;

  -- Re-empurra APENAS modelo_grades (o modelo é o dono de nome/taxonomia depois de criado).
  delete from public.modelo_grades where modelo_id = p.modelo_id;
  for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (p.modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;
end;
$$;

create or replace function public.aplicar_produto_ao_modelo(_produto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._aplicar_produto_ao_modelo_core(_produto_id);
end;
$$;

-- ======================================================================
-- vincular_oc_p_acabado --------------------------------------------------
-- ======================================================================
create or replace function public._vincular_oc_p_acabado_core(_oc_id uuid, _produto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
end;
$$;

create or replace function public.vincular_oc_p_acabado(_oc_id uuid, _produto_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._vincular_oc_p_acabado_core(_oc_id, _produto_id);
end;
$$;

-- ======================================================================
-- salvar_oc_p_acabado -----------------------------------------------------
-- ======================================================================
-- _dados = colunas escalares da OC (inclui grade_proporcao/variantes como sub-campos jsonb;
-- produto_acabado_id só é aplicado NA CRIAÇÃO — trocar vínculo depois é só via
-- vincular_oc_p_acabado, pra não desvincular sem querer num save comum);
-- _grade = grade_detalhe completa {"<ordem>":{"<tam>":{"pedida","recebida","defeito"}}}.
create or replace function public._salvar_oc_p_acabado_core(_id uuid, _dados jsonb, _grade jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    perform 1 from public.ocs_p_acabado where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'OC não encontrada';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);

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
      tenant_id, produto_acabado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      empresa_id, representante_id, ref_fornecedor, composicao,
      data_pedido, data_prevista, data_entrega, prazo_pagamento, parcelas_entrega,
      grade_proporcao, grade_detalhe, variantes,
      qtd_total, valor_unitario, desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real,
      nota_fiscal, responsavel_recebimento_id, devolucao, revisao,
      anexo_pedido_url, anexo_nf_url
    ) values (
      v_tenant, v_produto_id, v_nome, nullif(_dados->>'grupo_id', '')::uuid, nullif(_dados->>'categoria_id', '')::uuid,
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

  return v_id;
end;
$$;

create or replace function public.salvar_oc_p_acabado(_id uuid, _dados jsonb, _grade jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  return public._salvar_oc_p_acabado_core(_id, _dados, _grade);
end;
$$;

-- ======================================================================
-- REVOKEs (invariante #9: dos TRÊS no _core; PUBLIC+anon no wrapper) ------
-- ======================================================================
revoke execute on function public._salvar_produto_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public._criar_card_produto_acabado_core(uuid) from public, anon, authenticated;
revoke execute on function public._aplicar_produto_ao_modelo_core(uuid) from public, anon, authenticated;
revoke execute on function public._vincular_oc_p_acabado_core(uuid, uuid) from public, anon, authenticated;
revoke execute on function public._salvar_oc_p_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;

revoke execute on function public.salvar_produto_acabado(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_produto_acabado(uuid, jsonb, jsonb) to authenticated;
revoke execute on function public.criar_card_produto_acabado(uuid) from public, anon;
grant execute on function public.criar_card_produto_acabado(uuid) to authenticated;
revoke execute on function public.aplicar_produto_ao_modelo(uuid) from public, anon;
grant execute on function public.aplicar_produto_ao_modelo(uuid) to authenticated;
revoke execute on function public.vincular_oc_p_acabado(uuid, uuid) from public, anon;
grant execute on function public.vincular_oc_p_acabado(uuid, uuid) to authenticated;
revoke execute on function public.salvar_oc_p_acabado(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.salvar_oc_p_acabado(uuid, jsonb, jsonb) to authenticated;
