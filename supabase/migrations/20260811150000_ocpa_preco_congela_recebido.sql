-- Refinamentos OC P. Acabado (onda 2, ago/2026) — Item 4: preço congela ao receber
-- (paridade com a decisão do dono para tecido: uma vez 'recebido', valor
-- unitário/desconto/qtd pedida não mudam mais por aqui — corrija via "desfazer o
-- recebimento" antes). Item 6b: bolinha da sidebar para OC P. Acabado atrasada,
-- estendendo `sidebar_badges` (mesmo padrão de oc_tecido_atrasada/oc_aviamento_atrasada/
-- oc_etiqueta_atrasada).
--
-- Diff-validado contra a definição VIVA (pg_get_functiondef) antes de editar; nenhuma
-- outra cláusula do `_salvar_oc_p_acabado_core`/`sidebar_badges` foi tocada além do
-- descrito abaixo.

-- ======================================================================
-- Item 4 — helper: extrai só o campo "pedida" de um grade_detalhe, célula a célula
-- (recebida/defeito ficam de fora — aqueles continuam editáveis via
-- receber_oc_p_acabado mesmo após 'recebido'). Duas grades que só diferem em
-- recebida/defeito comparam IGUAIS por este helper.
-- ======================================================================
create or replace function public._pa_grade_pedida_only(_grade jsonb)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(jsonb_object_agg(
    o.key,
    (select coalesce(jsonb_object_agg(t.key, coalesce(nullif(t.value->>'pedida', '')::numeric, 0)), '{}'::jsonb)
       from jsonb_each(o.value) as t)
  ), '{}'::jsonb)
  from jsonb_each(coalesce(_grade, '{}'::jsonb)) as o;
$$;

-- ======================================================================
-- Item 4 — `_salvar_oc_p_acabado_core`: guarda de congelamento no ramo UPDATE.
-- Reescrita idêntica ao vivo (pg_get_functiondef) + o bloco novo logo após parsear
-- qtd_total/valor_unitario/desconto_pct — nenhuma outra linha mudou.
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
  -- congelamento de preço (item 4).
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
    select status, valor_unitario, desconto_pct, qtd_total, grade_detalhe
      into v_atual_status, v_atual_valor_unitario, v_atual_desconto_pct, v_atual_qtd_total, v_atual_grade
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
$function$;

-- Re-REVOKE defensivo (invariante 9 — CREATE OR REPLACE preserva ACL, mas o padrão do
-- projeto é restatar sempre que o _core é redefinido).
revoke execute on function public._pa_grade_pedida_only(jsonb) from public, anon, authenticated;
revoke execute on function public._salvar_oc_p_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ======================================================================
-- Item 6b — sidebar_badges: novo contador `oc_p_acabado_atrasada` (mesmo critério de
-- oc_tecido_atrasada — status 'encomendado' + data_prevista passada), gated pelo módulo
-- opt-in `produto_acabado` (senão a bolinha vazaria pra loja que nem liga o módulo).
-- Reescrita idêntica ao vivo (pg_get_functiondef) + o ramo novo.
-- ======================================================================
create or replace function public.sidebar_badges()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_tz text; v_hoje date;
  v_prontos int; v_alertas int; v_oc_tec int; v_oc_avi int; v_oc_etq int; v_otb int := 0;
  v_err_terc int; v_err_cq int; v_err_dir int; v_oc_pa int := 0;
begin
  if v_tenant is null or v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    return jsonb_build_object('prontos_lancar',0,'alertas_tecido',0,'oc_tecido_atrasada',0,
                              'oc_aviamento_atrasada',0,'oc_etiqueta_atrasada',0,'otb_divergencia',0,
                              'erro_terceirizados',0,'erro_cq',0,'erro_direcionamento',0,
                              'oc_p_acabado_atrasada',0);
  end if;

  select nullif(btrim(timezone),'') into v_tz from public.tenant_config where tenant_id = v_tenant;
  v_tz := coalesce(v_tz,'America/Sao_Paulo');
  v_hoje := (now() at time zone v_tz)::date;

  select count(*) into v_prontos from public.modelos m
  where m.tenant_id = v_tenant and coalesce(m.lancado,false) = false
    and exists (select 1 from public.cad c where c.modelo_id = m.id and c.tenant_id = v_tenant
      and public._cq_liberado(c.id)
      and not exists (select 1 from public.producao_terceirizados pt
        where pt.cad_id = c.id and coalesce(pt.interno,false) = false and coalesce(pt.aprovado,false) = false));

  select count(*) into v_alertas from public.ocs_tecido_itens it
  join public.ocs_tecido oc on oc.id = it.oc_tecido_id and oc.tenant_id = v_tenant
  where it.cq_alerta_status in ('alertado','troca_pendente');

  select count(*) into v_oc_tec from public.ocs_tecido oc
  where oc.tenant_id = v_tenant and oc.status = 'encomendado' and coalesce(oc.is_rolo,false) = false
    and oc.data_prevista_entrega is not null and oc.data_prevista_entrega < v_hoje;

  select count(*) into v_oc_avi from public.ocs_aviamento oc
  where oc.tenant_id = v_tenant and oc.status = 'encomendado'
    and oc.data_prevista_entrega is not null and oc.data_prevista_entrega < v_hoje;

  select count(*) into v_oc_etq from public.ocs_etiqueta oc
  where oc.tenant_id = v_tenant and oc.status = 'encomendado'
    and oc.data_prevista_entrega is not null and oc.data_prevista_entrega < v_hoje;

  -- #Erro por etapa — só conta modelos que estão REALMENTE na etapa (gate igual ao da lista).
  -- Serviços e CQ entram após o corte; Direcionamento após CQ liberado.
  select count(*) into v_err_terc from public.modelos m
  where m.tenant_id = v_tenant and m.revisao_pendente->>'terceirizados' = 'true'
    and exists (select 1 from public.cad c where c.modelo_id = m.id and c.enviado_corte = true);
  select count(*) into v_err_cq from public.modelos m
  where m.tenant_id = v_tenant and m.revisao_pendente->>'cq' = 'true'
    and exists (select 1 from public.cad c where c.modelo_id = m.id and c.enviado_corte = true);
  select count(*) into v_err_dir from public.modelos m
  where m.tenant_id = v_tenant and m.revisao_pendente->>'direcionamento' = 'true'
    and exists (select 1 from public.cad c where c.modelo_id = m.id and public._cq_liberado(c.id));

  if public.tenant_module_enabled('otb') then
    select count(*) into v_otb from public._otb_colecao_totais(v_tenant) t where t.realizado > t.total;
  end if;

  if public.tenant_module_enabled('produto_acabado') then
    select count(*) into v_oc_pa from public.ocs_p_acabado oc
    where oc.tenant_id = v_tenant and oc.status = 'encomendado'
      and oc.data_prevista is not null and oc.data_prevista < v_hoje;
  end if;

  return jsonb_build_object(
    'prontos_lancar', coalesce(v_prontos,0), 'alertas_tecido', coalesce(v_alertas,0),
    'oc_tecido_atrasada', coalesce(v_oc_tec,0), 'oc_aviamento_atrasada', coalesce(v_oc_avi,0),
    'oc_etiqueta_atrasada', coalesce(v_oc_etq,0), 'otb_divergencia', coalesce(v_otb,0),
    'erro_terceirizados', coalesce(v_err_terc,0), 'erro_cq', coalesce(v_err_cq,0),
    'erro_direcionamento', coalesce(v_err_dir,0), 'oc_p_acabado_atrasada', coalesce(v_oc_pa,0));
end $function$;

-- Re-REVOKE/GRANT defensivo (mesma ACL de antes: authenticated só; anon/PUBLIC fora).
revoke execute on function public.sidebar_badges() from public, anon;
grant execute on function public.sidebar_badges() to authenticated;
