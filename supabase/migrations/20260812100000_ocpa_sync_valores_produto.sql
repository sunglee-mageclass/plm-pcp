-- Produto Acabado (Revenda) — sync "Compra→Produto": pedido do dono (ago/2026) — "o valor
-- unitário e desconto no card devem ser atualizados de acordo com a OC". Quando um produto
-- tem uma OC vinculada, ela é a fonte da verdade da compra REAL (mesmo espírito da
-- invariante #13/item 4 "preço congela pela OC" já aplicada ao lado tecido — ver
-- 20260811150000_ocpa_preco_congela_recebido.sql). Antes desta migração, `produtos_acabados.
-- valor_unitario`/`desconto_pct` só mudavam pelo próprio card (setor 1 · Compra) e podiam
-- divergir silenciosamente do que estava realmente na OC.
--
-- Dois pontos de sync, no MESMO txn de cada RPC (nenhum trigger novo — os dois já são
-- SECURITY DEFINER plpgsql, mais simples manter aqui perto da lógica que já deriva
-- v_valor_unitario/v_desconto_pct):
--   1. `_salvar_oc_p_acabado_core` — toda vez que uma OC COM produto_acabado_id é salva
--      (criação OU edição), empurra valor_unitario/desconto_pct pro produto.
--   2. `_vincular_oc_p_acabado_core` — ao VINCULAR uma OC existente a um produto, o produto
--      herda os valores da OC na hora (senão ficaria com o valor antigo até o próximo save
--      da OC). Desvincular (_produto_id is null) NÃO mexe em nada — decisão consciente, ver
--      comentário no bloco abaixo.
--
-- DECISÃO (escopo desta rodada): só `valor_unitario`/`desconto_pct` sincronizam — NÃO
-- `qtd_total`. O pedido do dono citou "valor unitário e desconto"; sincronizar qtd_total
-- também sobrescreveria a distribuição por variante (grade de cor) que o produto mantém
-- por conta própria em `produto_acabado_variantes` (Σqtd das variantes pode legitimamente
-- divergir da Qtd total da OC — ex.: produto replanejado depois do pedido feito). Pergunta
-- em aberto pro dono: se ele quiser esse sync também, precisa decidir COMO redistribuir
-- (`redistribuir=true` na salvar_produto_acabado, ou preservar as qtds e só avisar
-- divergência) — não decidido aqui.
--
-- Diff-validado contra a definição VIVA (pg_get_functiondef, pós 20260811160000/170000)
-- antes de editar — a ÚNICA mudança em `_salvar_oc_p_acabado_core` é (a) o SELECT do estado
-- atual, no ramo UPDATE, passa a trazer também `produto_acabado_id` pra dentro de
-- `v_produto_id` (variável já existia, só usada até aqui no ramo INSERT) e (b) o bloco novo
-- de sync logo antes do `return v_id`. Em `_vincular_oc_p_acabado_core` a única mudança é o
-- bloco de sync logo após o UPDATE existente. Nenhuma outra linha/cláusula tocada.

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

  -- Sync Compra→Produto (novo): OC com produto vinculado empurra valor_unitario/
  -- desconto_pct pro card do produto — ver decisão sobre qtd_total no cabeçalho da
  -- migração. OC avulsa (v_produto_id null) não toca em nada.
  if v_produto_id is not null then
    update public.produtos_acabados
      set valor_unitario = v_valor_unitario, desconto_pct = v_desconto_pct, updated_at = now()
      where id = v_produto_id and tenant_id = v_tenant;
  end if;

  return v_id;
end;
$function$;

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

  -- Sync Compra→Produto (novo): ao VINCULAR (não ao desvincular), o produto herda
  -- valor_unitario/desconto_pct da OC na hora — mesmo espírito de `_salvar_oc_p_acabado_
  -- core` acima, pra não deixar o card mostrando o valor antigo até o próximo save da OC.
  if _produto_id is not null then
    update public.produtos_acabados set
      valor_unitario = (select oc.valor_unitario from public.ocs_p_acabado oc where oc.id = _oc_id),
      desconto_pct = (select oc.desconto_pct from public.ocs_p_acabado oc where oc.id = _oc_id),
      updated_at = now()
    where id = _produto_id and tenant_id = v_tenant;
  end if;
end;
$function$;

-- Re-REVOKE defensivo (invariante #9 — dos TRÊS, sempre restatado ao redefinir o _core).
revoke execute on function public._salvar_oc_p_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public._vincular_oc_p_acabado_core(uuid, uuid) from public, anon, authenticated;
