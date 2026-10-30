-- ============================================================================
-- R13 T1+T2+T3 — INVERSO NEUTRO (_down). Devolve as 4 funcoes T1 + os corpos T2 (PA) e T3 (PI: escritores/excluir/guardas de produto
-- + cambio/landed por item) de ANTES + leitores compartilhados + espelho categoria, DROPa as 7 RPCs novas da T2 e as 8+2 da T3
-- (wrappers + cores + applier/helpers), repoe o ponteiro do cabecalho a partir do item unico e as colunas legadas (so onde
-- IS DISTINCT FROM). As TABELAS de itens FICAM (inertes). Sem DROP das tabelas (ver _down_drop).
--   docker exec -i supabase_db_banco-local psql -U postgres -d copia4 -v ON_ERROR_STOP=1 < supabase/rollback/20261105100000_urg_r13_oc_itens_down.sql
-- RECUSA se existir OC com != 1 item (r13_down_oc_varios_produtos: N — o dono exclui/desfaz essas OCs ou mantem a R13).
-- RECUSA se o vivo nao for o "depois" da R13 (md5) — nao rodar fora de ordem.
-- ============================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

-- guarda: o vivo tem de ser o "depois" da R13 (md5-r13.txt). Se alguem ja desfez (ANTES) ou outra frente mexeu, PARA.
DO $g$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_oc_p_acabado_numero()','03e778c0069e6ea85c1f607d7bb55e02'),
    ('public.fn_oc_importado_numero()','84012d0b0d93f2f642e8d943b56b67b1'),
    ('public.enforce_oc_pa_vinculo_unico()','6a1cc63439c2987525a777fd9f37e2da'),
    ('public.enforce_oc_importado_vinculo_unico()','1911cb571aa7cf977903dee0744a26b6'),
    -- T2: confere que o lado Produto Acabado tambem esta no DEPOIS (nao desfazer fora de ordem)
    ('public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)','2db79beeb9f0cbc51b2a77598de1e59a'),
    ('public._receber_oc_p_acabado_core(uuid,jsonb,jsonb)','125a50b41e8524e0a849bb5b26a5013f'),
    ('public._vincular_oc_p_acabado_core(uuid,uuid)','68df0a0954571d756a62f3e3c570893b'),
    ('public._custo_unitario_modelos_core(uuid[])','81de3239233d2efb3565ed3c5ce8cfb3'),
    ('public._estoque_extrato_insumo_core(uuid,uuid)','227331479ecf99b9e39eeca40bbf4512'),
    ('public._dashboard_leadtime_itens_core(uuid,text,text)','6a8e9b7662e56356ec5602179636c24c'),
    ('public.fn_modelo_espelho_categoria()','2e0c70f661e42610e87da2b934dec962'),
    -- T3: confere que o lado Produto Importado tambem esta no DEPOIS (nao desfazer fora de ordem)
    ('public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)','386051cfffa78f354555cc05721f6cf6'),
    ('public._receber_oc_importado_core(uuid,jsonb,jsonb)','7f2c60f6e863450b149304c9dde6e5d3'),
    ('public._excluir_oc_importado_core(uuid)','edf21a91a5c17830550111db37e18172'),
    ('public._excluir_produto_importado_core(uuid)','44472997492c854cdbc88fc76febc89a'),
    ('public._limpar_produto_importado_core(uuid)','d863544b621523cf9c1d4532b4909759'),
    ('public._imp_etapas_brl_oc(uuid)','18301e31b0f01b31cb6158afc9556ef3'),
    ('public._imp_recalcular_landed_real_oc(uuid)','d9d8b3f88aadc5b30bfae20646d612a6')
  ) x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'r13_down: % nao esta no DEPOIS da R13 (md5 %) - nao desfazer fora de ordem', r.f, coalesce(v,'ausente') USING ERRCODE='P0001';
    END IF;
  END LOOP;
END $g$;

-- recusa OC com != 1 item (a volta so representa OC de 1 produto)
DO $v$
DECLARE v_n int; v_nums text;
BEGIN
  SELECT count(*), string_agg(numero, ', ') INTO v_n, v_nums FROM (
    SELECT o.numero FROM public.ocs_p_acabado o
     WHERE (SELECT count(*) FROM public.ocs_p_acabado_itens it WHERE it.oc_id = o.id) <> 1
    UNION ALL
    SELECT o.numero FROM public.ocs_importado o
     WHERE (SELECT count(*) FROM public.ocs_importado_itens it WHERE it.oc_id = o.id) <> 1
  ) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'r13_down_oc_varios_produtos: % (%) - exclua/desfaca essas OCs ou mantenha a R13', v_n, v_nums USING ERRCODE='P0001';
  END IF;
END $v$;

-- 1) devolve as 4 funcoes de ANTES (o ponteiro volta a ser gravavel; a guarda antiga "1 OC por produto" volta).
CREATE OR REPLACE FUNCTION public.fn_oc_p_acabado_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sig text; v_num bigint;
begin
  if new.numero is not null and new.numero <> '' then return new; end if;
  v_sig := public._norm3((select nome_fantasia from empresas where id=new.empresa_id));
  if v_sig = '' then v_sig := 'FOR'; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then v_sig := v_sig || 'ACE';
  else v_sig := v_sig || substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,1)
                      || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,2);
  end if;
  select coalesce(max((substring(numero from '([0-9]+)$'))::bigint),0)+1 into v_num
    from public.ocs_p_acabado where tenant_id=new.tenant_id and numero ~ ('^'||v_sig||'-[0-9]+$');
  new.numero := v_sig || '-' || lpad(v_num::text,5,'0');
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_oc_importado_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sig text; v_num bigint;
begin
  if new.numero is not null and new.numero <> '' then return new; end if;
  v_sig := public._norm3((select nome_fantasia from empresas where id=new.empresa_id));
  if v_sig = '' then v_sig := 'FOR'; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then v_sig := v_sig || 'ACE';
  else v_sig := v_sig || substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,1)
                      || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,2);
  end if;
  select coalesce(max((substring(numero from '([0-9]+)$'))::bigint),0)+1 into v_num
    from public.ocs_importado where tenant_id=new.tenant_id and numero ~ ('^'||v_sig||'-[0-9]+$');
  new.numero := v_sig || '-' || lpad(v_num::text,5,'0');
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_oc_pa_vinculo_unico()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare v_num text;
begin
  if new.produto_acabado_id is null then return new; end if;
  select numero into v_num from public.ocs_p_acabado
   where produto_acabado_id = new.produto_acabado_id and id is distinct from new.id limit 1;
  if v_num is not null then
    raise exception 'Este produto já tem a OC % vinculada — desvincule antes.', v_num using errcode='P0001';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_oc_importado_vinculo_unico()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare v_num text;
begin
  if new.produto_importado_id is null then return new; end if;
  select numero into v_num from public.ocs_importado
   where produto_importado_id = new.produto_importado_id and id is distinct from new.id limit 1;
  if v_num is not null then
    raise exception 'Este produto já tem a OC % vinculada — desvincule antes.', v_num using errcode='P0001';
  end if;
  return new;
end $function$;

-- 2) repoe o ponteiro + colunas legadas a partir do item unico, SO onde IS DISTINCT FROM (parcelas so refazem onde mudou).
UPDATE public.ocs_p_acabado o SET produto_acabado_id = it.produto_acabado_id
  FROM public.ocs_p_acabado_itens it WHERE it.oc_id = o.id AND o.produto_acabado_id IS DISTINCT FROM it.produto_acabado_id;
UPDATE public.ocs_p_acabado o SET
    nome_produto = coalesce(it.nome_produto, o.nome_produto), grupo_id = it.grupo_id, categoria_id = it.categoria_id,
    subcategoria1_id = it.subcategoria1_id, subcategoria2_id = it.subcategoria2_id, ref_fornecedor = it.ref_fornecedor,
    composicao = it.composicao, grade_proporcao = it.grade_proporcao, grade_detalhe = it.grade_detalhe, variantes = it.variantes,
    qtd_total = it.qtd_total, valor_unitario = it.valor_unitario, desconto_pct = it.desconto_pct, valor_bruto = it.valor_bruto,
    valor_total_desconto = it.valor_total_desconto, valor_unitario_real = it.valor_unitario_real, status = it.status,
    data_entrega = it.data_entrega, nota_fiscal = it.nota_fiscal, anexo_nf_url = it.anexo_nf_url,
    responsavel_recebimento_id = it.responsavel_recebimento_id, devolucao = it.devolucao, revisao = it.revisao
  FROM public.ocs_p_acabado_itens it
  WHERE it.oc_id = o.id AND (
    o.nome_produto IS DISTINCT FROM it.nome_produto OR o.grupo_id IS DISTINCT FROM it.grupo_id
    OR o.categoria_id IS DISTINCT FROM it.categoria_id OR o.subcategoria1_id IS DISTINCT FROM it.subcategoria1_id
    OR o.subcategoria2_id IS DISTINCT FROM it.subcategoria2_id OR o.ref_fornecedor IS DISTINCT FROM it.ref_fornecedor
    OR o.composicao IS DISTINCT FROM it.composicao OR o.grade_proporcao IS DISTINCT FROM it.grade_proporcao
    OR o.grade_detalhe IS DISTINCT FROM it.grade_detalhe OR o.variantes IS DISTINCT FROM it.variantes
    OR o.qtd_total IS DISTINCT FROM it.qtd_total OR o.valor_unitario IS DISTINCT FROM it.valor_unitario
    OR o.desconto_pct IS DISTINCT FROM it.desconto_pct OR o.valor_bruto IS DISTINCT FROM it.valor_bruto
    OR o.valor_total_desconto IS DISTINCT FROM it.valor_total_desconto OR o.valor_unitario_real IS DISTINCT FROM it.valor_unitario_real
    OR o.status IS DISTINCT FROM it.status OR o.data_entrega IS DISTINCT FROM it.data_entrega
    OR o.nota_fiscal IS DISTINCT FROM it.nota_fiscal OR o.anexo_nf_url IS DISTINCT FROM it.anexo_nf_url
    OR o.responsavel_recebimento_id IS DISTINCT FROM it.responsavel_recebimento_id
    OR o.devolucao IS DISTINCT FROM it.devolucao OR o.revisao IS DISTINCT FROM it.revisao);

UPDATE public.ocs_importado o SET produto_importado_id = it.produto_importado_id
  FROM public.ocs_importado_itens it WHERE it.oc_id = o.id AND o.produto_importado_id IS DISTINCT FROM it.produto_importado_id;
UPDATE public.ocs_importado o SET
    nome_produto = coalesce(it.nome_produto, o.nome_produto), grupo_id = it.grupo_id, categoria_id = it.categoria_id,
    subcategoria1_id = it.subcategoria1_id, subcategoria2_id = it.subcategoria2_id, ref_fornecedor = it.ref_fornecedor,
    composicao = it.composicao, grade_proporcao = it.grade_proporcao, grade_detalhe = it.grade_detalhe, variantes = it.variantes,
    qtd_total = it.qtd_total, valor_unitario_m1 = it.valor_unitario_m1, peso_kg = it.peso_kg, transporte_m2 = it.transporte_m2,
    desconto_pct = it.desconto_pct, valor_bruto = it.valor_bruto, valor_total_desconto = it.valor_total_desconto,
    valor_unitario_real = it.valor_unitario_real, custo_unitario_landed_real = it.custo_unitario_landed_real, status = it.status,
    data_entrega = it.data_entrega, nota_fiscal = it.nota_fiscal, anexo_nf_url = it.anexo_nf_url,
    responsavel_recebimento_id = it.responsavel_recebimento_id, devolucao = it.devolucao, revisao = it.revisao
  FROM public.ocs_importado_itens it
  WHERE it.oc_id = o.id AND (
    o.nome_produto IS DISTINCT FROM it.nome_produto OR o.grupo_id IS DISTINCT FROM it.grupo_id
    OR o.categoria_id IS DISTINCT FROM it.categoria_id OR o.subcategoria1_id IS DISTINCT FROM it.subcategoria1_id
    OR o.subcategoria2_id IS DISTINCT FROM it.subcategoria2_id OR o.ref_fornecedor IS DISTINCT FROM it.ref_fornecedor
    OR o.composicao IS DISTINCT FROM it.composicao OR o.grade_proporcao IS DISTINCT FROM it.grade_proporcao
    OR o.grade_detalhe IS DISTINCT FROM it.grade_detalhe OR o.variantes IS DISTINCT FROM it.variantes
    OR o.qtd_total IS DISTINCT FROM it.qtd_total OR o.valor_unitario_m1 IS DISTINCT FROM it.valor_unitario_m1
    OR o.peso_kg IS DISTINCT FROM it.peso_kg OR o.transporte_m2 IS DISTINCT FROM it.transporte_m2
    OR o.desconto_pct IS DISTINCT FROM it.desconto_pct OR o.valor_bruto IS DISTINCT FROM it.valor_bruto
    OR o.valor_total_desconto IS DISTINCT FROM it.valor_total_desconto OR o.valor_unitario_real IS DISTINCT FROM it.valor_unitario_real
    OR o.custo_unitario_landed_real IS DISTINCT FROM it.custo_unitario_landed_real OR o.status IS DISTINCT FROM it.status
    OR o.data_entrega IS DISTINCT FROM it.data_entrega OR o.nota_fiscal IS DISTINCT FROM it.nota_fiscal
    OR o.anexo_nf_url IS DISTINCT FROM it.anexo_nf_url OR o.responsavel_recebimento_id IS DISTINCT FROM it.responsavel_recebimento_id
    OR o.devolucao IS DISTINCT FROM it.devolucao OR o.revisao IS DISTINCT FROM it.revisao);


-- ============================ T2 (Produto Acabado): restaura os corpos de ANTES + DROP das RPCs novas ============================
-- Os leitores (_custo/_leadtime/_extrato) e o espelho de ANTES leem o CABECALHO (produto_*_id), ja reposto acima.
CREATE OR REPLACE FUNCTION public._salvar_oc_p_acabado_core(_id uuid, _dados jsonb, _grade jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_p_acabado
        where id = _id and tenant_id = v_tenant for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
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

  if _id is not null and v_atual_status = 'recebido' then
    if v_valor_unitario is distinct from v_atual_valor_unitario
       or v_desconto_pct is distinct from v_atual_desconto_pct
       or v_qtd_total is distinct from v_atual_qtd_total
       or public._pa_grade_pedida_only(_grade) is distinct from public._pa_grade_pedida_only(v_atual_grade)
    then
      raise exception 'OC recebida — desfaça o recebimento para alterar valores.' using errcode = 'P0001';
    end if;
  end if;

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
      anexo_pedido_url, anexo_nf_url, data_nota_entrada
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
      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url', nullif(_dados->>'data_nota_entrada', '')::date
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
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
  end if;

  if v_produto_id is not null then
    update public.produtos_acabados
      set valor_unitario = v_valor_unitario, desconto_pct = v_desconto_pct, updated_at = now()
      where id = v_produto_id and tenant_id = v_tenant;

    perform public._pa_recomputar_precos_modelo(v_produto_id);
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._receber_oc_p_acabado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- NOVO (set/2026): materializa cad_etiquetas do BOM (modelo_etiquetas) — a etiqueta/insumo a
  -- separar na Explosão (troca de etiqueta da revenda). quantidade_planejada = quantidade_enviar =
  -- consumo × peças reais recebidas. Idempotente: apaga e regrava as do cad (sem UNIQUE p/ upsert).
  -- O caminho manufaturado NÃO usa esta função — só revenda passa por aqui.
  delete from public.cad_etiquetas where cad_id = v_cad_id;
  insert into public.cad_etiquetas (cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar)
  -- [urg R1] insumo vinculado a UM tamanho: consumo x pecas recebidas DAQUELE tamanho (grade real do cad, regravada acima)
  select v_cad_id, me.etiqueta_id, me.cor_id, me.consumo,
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2),
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2)
  from public.modelo_etiquetas me
  where me.modelo_id = v_produto.modelo_id;

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
$function$
;

CREATE OR REPLACE FUNCTION public._vincular_oc_p_acabado_core(_oc_id uuid, _produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public._excluir_oc_p_acabado_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select status into v_status from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: oc' using errcode = 'P0002';
  end if;

  if v_status = 'recebido' then
    raise exception 'Não é possível excluir: OC já recebida (materializou CAD/CQ). Estorne o recebimento antes.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.parcelas where oc_p_acabado_id = _oc_id and status = 'pago') then
    raise exception 'Não é possível excluir: a OC tem parcela paga no financeiro.' using errcode = 'P0001';
  end if;

  -- Parcelas NÃO pagas somem via ON DELETE CASCADE (oc_p_acabado_id, Task 3); a parcela
  -- paga já foi barrada acima, então nenhum DELETE explícito é necessário aqui.
  delete from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._excluir_produto_acabado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_oc_id uuid;
  v_oc_numero text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  perform 1 from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: produto' using errcode = 'P0002';
  end if;

  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado
    where produto_acabado_id = _produto_id and tenant_id = v_tenant
    limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de excluir.', coalesce(v_oc_numero, 'sem número')
      using errcode = 'P0001';
  end if;

  delete from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._limpar_produto_acabado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_modelo_id uuid;
  v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select modelo_id into v_modelo_id from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'nao_encontrado: produto' using errcode = 'P0002'; end if;
  -- Só rascunho (sem card no Planejamento).
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  -- Guarda de OC: zerar qtd/variantes/valor com pedido ativo dessincronizaria a OC.
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado where produto_acabado_id = _produto_id and tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de limpar.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;

  -- Zera os campos editáveis; PRESERVA id/colecao_id/subcolecao/ref/mix_id/modelo_id(null).
  update public.produtos_acabados set
    nome = '',
    grupo_id = null, categoria_id = null, subcategoria1_id = null, subcategoria2_id = null,
    semana = null, empresa_id = null, representante_id = null,
    ref_fornecedor = null, composicao = null,
    grade_proporcao = '{}'::jsonb, qtd_total = 0, valor_unitario = 0, desconto_pct = 0,
    insumos_total = 0, markup_atacado = null, markup_varejo = null,
    tamanho_tipo = null,  -- [tamanho-em v1]
    categoria_tecido_id = null, material_aviamento_id = null,  -- [i3 v1] (ruling do controlador)
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_acabado_variantes where produto_acabado_id = _produto_id;
end $function$
;

CREATE OR REPLACE FUNCTION public._salvar_produto_acabado_core(_id uuid, _dados jsonb, _variantes jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_modelo_id uuid;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_sub1_id uuid;
  v_sub2_id uuid;
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
  v_nome_final text;
  v_categoria_final uuid;
  v_sub1_final uuid;
  v_sub2_final uuid;
  v_nome_atual text;
  v_grupo_atual uuid;
  v_categoria_atual uuid;
  v_sub1_atual uuid;
  v_sub2_atual uuid;
  v_tem_oc boolean;
  v_tt text;  -- [tamanho-em v1]
  v_ordens_antes int[] := '{}'::int[];  -- [leves L8, sku #22]
  v_cat_tecido uuid;     -- [i3 v1]
  v_mat_aviamento uuid;  -- [i3 v1]
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
  v_sub1_id := nullif(_dados->>'subcategoria1_id', '')::uuid;
  v_sub2_id := nullif(_dados->>'subcategoria2_id', '')::uuid;

  if _id is null then
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    v_modelo_id := null;
  else
    select modelo_id, nome, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id
      into v_modelo_id, v_nome_atual, v_grupo_atual, v_categoria_atual, v_sub1_atual, v_sub2_atual
      from public.produtos_acabados
      where id = _id and tenant_id = v_tenant
      for update;  -- [pa-sync v1] trava a linha: o "antes" comparado abaixo e o UPDATE veem o MESMO estado
    if not found then
      raise exception 'Produto não encontrado';
    end if;

    v_tem_oc := exists (select 1 from public.ocs_p_acabado where produto_acabado_id = _id);
    if v_tem_oc and (
      coalesce(v_nome, v_nome_atual) is distinct from v_nome_atual
      or v_grupo_id is distinct from v_grupo_atual
      or v_categoria_id is distinct from v_categoria_atual
      or v_sub1_id is distinct from v_sub1_atual
      or v_sub2_id is distinct from v_sub2_atual
    ) then
      raise exception 'Produto com pedido vinculado — desvincule a OC para alterar a identidade.'
        using errcode = 'P0001';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);
  v_redistribuir := coalesce(_dados->>'redistribuir', 'false') = 'true';

  v_markup_atacado := nullif(_dados->>'markup_atacado', '')::numeric;
  v_markup_varejo := nullif(_dados->>'markup_varejo', '')::numeric;
  if (v_markup_atacado is not null and v_markup_atacado <= 0)
     or (v_markup_varejo is not null and v_markup_varejo <= 0) then
    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  -- [tamanho-em v1] "Tamanho em" (P-85 A): só quando a chave vem no _dados (a tela manda só se mudou). Com card, o
  -- gatilho do produto (fn_produto_tamanho_tipo_handover) leva o valor ao modelo espelho e limpa o do produto.
  if _dados ? 'tamanho_tipo' then
    v_tt := nullif(_dados->>'tamanho_tipo', '');
    if v_tt is null or v_tt not in ('letra', 'numero') then
      raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
    end if;
  end if;

  -- [i3 v1] Release I3: Categoria do tecido (grupo nao Acessorios) / Material do aviamento (Acessorios) do produto - so
  -- quando a chave vem no _dados (padrao tamanho_tipo; a tela manda sempre as 2); vazio = limpa. Fora da trava de
  -- identidade com OC e da trava da Integracao (campo informativo, P-219 A). Id de outra loja = recusa (o gatilho
  -- trg_pa_cat_material_tenant confere de novo).
  if _dados ? 'categoria_tecido_id' then
    v_cat_tecido := nullif(_dados->>'categoria_tecido_id', '')::uuid;
    if v_cat_tecido is not null and not exists (select 1 from public.categorias_tecido ct
                                                 where ct.id = v_cat_tecido and ct.tenant_id = v_tenant) then
      raise exception 'Categoria do tecido não encontrada nesta loja.' using errcode = 'P0001';
    end if;
  end if;
  if _dados ? 'material_aviamento_id' then
    v_mat_aviamento := nullif(_dados->>'material_aviamento_id', '')::uuid;
    if v_mat_aviamento is not null and not exists (select 1 from public.materiais_aviamento ma
                                                    where ma.id = v_mat_aviamento and ma.tenant_id = v_tenant) then
      raise exception 'Material do aviamento não encontrado nesta loja.' using errcode = 'P0001';
    end if;
  end if;

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
    -- [leves L8, preco M1] custo_previsto da linha JA e preco x consumo x (1 + perda) (por peca) -> soma direta (antes
    -- multiplicava o consumo de novo); = _pa_recomputar_precos_modelo e _custo_unitario_modelos_core (CTE pa).
    select coalesce(sum(coalesce(me.custo_previsto, 0)), 0) into v_insumos
      from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;
  end if;

  if _id is null then
    insert into public.produtos_acabados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total,
      markup_atacado, markup_varejo, foto_url, tamanho_tipo, categoria_tecido_id, material_aviamento_id  -- [i3 v1]
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      v_sub1_id, v_sub2_id,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos,
      v_markup_atacado, v_markup_varejo, nullif(_dados->>'foto_url', ''), v_tt,  -- [tamanho-em v1]
      v_cat_tecido, v_mat_aviamento  -- [i3 v1]
    ) returning id into v_id;
  else
    update public.produtos_acabados set
      nome = coalesce(v_nome, nome),
      ref = coalesce(nullif(_dados->>'ref', ''), ref),
      grupo_id = v_grupo_id,
      categoria_id = v_categoria_id,
      subcategoria1_id = v_sub1_id,
      subcategoria2_id = v_sub2_id,
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
      -- Última edição manda (set/2026): markup não-null LIMPA o preço fixo do canal, espelhando a RPC
      -- dedicada `_salvar_precos_fixo_produto_acabado_core`. Sem isto o save em LOTE deixava fixo E
      -- markup no mesmo canal (banco inconsistente + arredondamento ressuscitava no próximo ciclo).
      preco_atacado_fixo = case when v_markup_atacado is not null then null else preco_atacado_fixo end,
      preco_varejo_fixo = case when v_markup_varejo is not null then null else preco_varejo_fixo end,
      foto_url = nullif(_dados->>'foto_url', ''),
      tamanho_tipo = case when _dados ? 'tamanho_tipo' then v_tt else tamanho_tipo end,  -- [tamanho-em v1]
      categoria_tecido_id = case when _dados ? 'categoria_tecido_id' then v_cat_tecido else categoria_tecido_id end,  -- [i3 v1]
      material_aviamento_id = case when _dados ? 'material_aviamento_id' then v_mat_aviamento else material_aviamento_id end,  -- [i3 v1]
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning nome, categoria_id, subcategoria1_id, subcategoria2_id
      into v_nome_final, v_categoria_final, v_sub1_final, v_sub2_final;
    v_id := _id;

    -- [pa-sync v1] P-136 A: o card só recebe do produto o que MUDOU neste save (valor novo IS DISTINCT FROM o gravado
    -- antes, lido acima), coluna a coluna; o resto fica como está no card (ex.: Categoria trocada no Planejamento).
    -- Nada mudou (ou o card já tem o valor, ex.: nome já levado por trg_espelho_modelo_nome_ref) = nenhum UPDATE:
    -- o rev do card não sobe e a trava da Integração (trg_zz_integracao_trava) não é acionada.
    if v_modelo_id is not null then
      update public.modelos set
        nome = case when v_nome_final is distinct from v_nome_atual then v_nome_final else nome end,
        categoria_principal_id = case when v_categoria_final is distinct from v_categoria_atual
                                      then v_categoria_final else categoria_principal_id end,
        subcategoria1_id = case when v_sub1_final is distinct from v_sub1_atual then v_sub1_final else subcategoria1_id end,
        subcategoria2_id = case when v_sub2_final is distinct from v_sub2_atual then v_sub2_final else subcategoria2_id end
      where id = v_modelo_id
        and ((v_nome_final is distinct from v_nome_atual and nome is distinct from v_nome_final)
          or (v_categoria_final is distinct from v_categoria_atual and categoria_principal_id is distinct from v_categoria_final)
          or (v_sub1_final is distinct from v_sub1_atual and subcategoria1_id is distinct from v_sub1_final)
          or (v_sub2_final is distinct from v_sub2_atual and subcategoria2_id is distinct from v_sub2_final));
    end if;
  end if;

  -- [leves L8, sku #22] ordens das variantes ANTES deste save (a grade cor x tamanho do card espelho mora em
  -- modelo_grades com variante_numero = ordem).
  select coalesce(array_agg(pav.ordem), '{}'::int[]) into v_ordens_antes
    from public.produto_acabado_variantes pav where pav.produto_acabado_id = v_id;

  delete from public.produto_acabado_variantes where produto_acabado_id = v_id;
  insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
  select v_tenant, v_id,
         (elem->>'ordem')::int,
         nullif(elem->>'cor_id', '')::uuid,
         nullif(elem->>'cor_apelido_id', '')::uuid,
         coalesce((elem->>'peso')::numeric, 0),
         coalesce((elem->>'qtd')::int, 0)
  from jsonb_array_elements(v_variantes_final) elem;

  -- [leves L8, sku #22] a variante que SAIU neste save leva junto a grade dela no card espelho: sem isto, uma variante
  -- nova que reusasse a mesma ordem herdava a grade da apagada. So as ordens que existiam antes e nao vieram agora (a
  -- grade de quem fica nao muda). Produto travado pela Integracao ja recusa mudar variantes (trg_zz_integracao_trava_var).
  if v_modelo_id is not null and cardinality(v_ordens_antes) > 0 then
    delete from public.modelo_grades g
     where g.modelo_id = v_modelo_id
       and g.variante_numero = any (v_ordens_antes)
       and not exists (select 1 from jsonb_array_elements(v_variantes_final) e
                        where (e->>'ordem')::int = g.variante_numero);
  end if;

  perform public._pa_recomputar_precos_modelo(v_id);

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._custo_unitario_modelos_core(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  with cad_conf as (
    select distinct on (c.modelo_id) c.modelo_id, c.id as cad_id
    from cad c
    where c.tenant_id = v_tenant and c.enviado_corte
    order by c.modelo_id, c.data_enviado_corte desc nulls last
  ),
  mat as (
    select cc.modelo_id,
      coalesce((select sum(case when ct.custo_cad is not null then ct.custo_cad
          else coalesce(ct.consumo_cad,0) * (1 + coalesce(ct.loss_percent_cad,0)/100.0)
               * public._preco_tecido_por_metro(cc.modelo_id, ct.tipo, ct.numero, ct.artigo_id) end)
        from cad_tecidos ct where ct.cad_id = cc.cad_id), 0)
      + coalesce((select sum(coalesce(ca.consumo,0) * coalesce(av.preco,0))
        from cad_aviamentos ca left join aviamentos av on av.id = ca.aviamento_id where ca.cad_id = cc.cad_id), 0)
      -- [urg R1] insumo vinculado a UM tamanho: custo REAL rateado como o previsto (Ruling A5) - consumo x fator, fator = pecas do
      -- tamanho / grade do CAD (_insumo_fator_custo: grade vazia = 1, tamanho fora da grade = 0), com o MESMO total da coluna grade
      -- abaixo (real, senao planejada, por linha de cad_grades). Insumo sem vinculo: fator 1 = o valor de antes.
      + COALESCE((SELECT SUM(COALESCE(ce.consumo,0)
          * public._insumo_fator_custo(public._insumo_tamanho_de(ce.etiqueta_id), public._grade_mapa_cad(cc.cad_id, true),
              (SELECT coalesce(sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)),0) FROM cad_grades g WHERE g.cad_id = cc.cad_id))
          * COALESCE(NULLIF((SELECT MAX(COALESCE(ve.preco,0)) FROM variantes_etiqueta ve WHERE ve.etiqueta_id = ce.etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM ce.cor_id),0), (SELECT et.preco FROM etiquetas et WHERE et.id = ce.etiqueta_id), 0)) FROM cad_etiquetas ce WHERE ce.cad_id = cc.cad_id), 0) as materials,
      coalesce((select sum(coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0)
            - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0))
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false
          and coalesce(pt.ativo,true)
          -- [R16 fix round 1/2, M2 + INFO R1] "o lancado" do servico = bloco com BRUTO (preco x qtd) > 0; soma o liquido
          -- (bruto - desconto + multa), que pode ser 0 (servico feito e todo descontado = custo 0, nao a prevista)
          and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade,
      -- [medios R16 preco M7, P-186 A] M.O. PREVISTA dos servicos SEM bloco externo lancado (por peca):
      --   (fix round 1/2, M2 + INFO R1: "lancado" = bloco externo ativo com BRUTO preco x qtd > 0; bloco vazio ainda nao
      --   lancou -> vale a prevista daquele servico; bloco lancado e todo descontado -> custo 0, nao a prevista)
      --   linha de modelo_servico_mo COM categoria -> entra se o cad NAO tem bloco externo ativo daquela categoria
      --     (com bloco, vale o lancado, ja somado em servico_total); costura/oficina INTERNA nunca tem lancado -> prevista;
      --   linha "Geral (legado)" (categoria NULL) -> entra se o cad NAO tem bloco externo ativo de servico SEM linha
      --     propria (sem categoria, ou de categoria sem linha no modelo) - esse lancado e o que substitui o "Geral".
      coalesce((select sum(s.valor) from modelo_servico_mo s
        where s.modelo_id = cc.modelo_id
          and case when s.categoria_terceirizado_id is not null
                then not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0
                                    and pt.categoria_terceirizado_id = s.categoria_terceirizado_id)
                else not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0
                                    and (pt.categoria_terceirizado_id is null
                                         or not exists (select 1 from modelo_servico_mo s2
                                                         where s2.modelo_id = cc.modelo_id
                                                           and s2.categoria_terceirizado_id = pt.categoria_terceirizado_id)))
              end), 0) as mo_prevista_sem_lancado
    from cad_conf cc
  ),
  pa as (
    select p.modelo_id,
      p.valor_unitario,
      p.desconto_pct,
      oc.valor_unitario_real,
      oc.status as oc_status,
      -- [medios R16, preco M1] custo_previsto da linha JA e preco x consumo x (1 + perda) (por peca; = o que a ficha
      -- soma em totaisBom) -> soma direta (antes multiplicava o consumo de novo).
      coalesce((select sum(coalesce(me.custo_previsto,0))
                from modelo_etiquetas me where me.modelo_id = p.modelo_id), 0) as insumos_por_peca
    from produtos_acabados p
    left join ocs_p_acabado oc on oc.produto_acabado_id = p.id
    where p.tenant_id = v_tenant and p.modelo_id is not null
  ),
  imp as (
    -- Card: `landed` (previsto). OC (se vinculada): status + custo landed REAL da OC.
    select p.modelo_id,
      public._imp_custo_landed(p.id) as landed,
      oc.status as oc_status,
      oc.custo_unitario_landed_real as landed_real
    from produtos_importados p
    left join ocs_importado oc on oc.produto_importado_id = p.id
    where p.tenant_id = v_tenant and p.modelo_id is not null
  )
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'previsto', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then coalesce(pa.valor_unitario,0) * (1 - coalesce(pa.desconto_pct,0)/100.0) + coalesce(pa.insumos_por_peca,0)
                when m.origem = 'importado' and imp.modelo_id is not null
                  then coalesce(imp.landed,0)
                else coalesce(m.custo_peca_previsto,0) end,
    'real', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then case when pa.oc_status = 'recebido'
                         -- [medios R16, R12 INFO 6] recebida sem valor real (a coluna e NOT NULL DEFAULT 0: "sem" = 0)
                         -- -> o valor da compra (bruto - desconto), nunca 0
                         then coalesce(nullif(pa.valor_unitario_real, 0),
                                       coalesce(pa.valor_unitario,0) * (1 - coalesce(pa.desconto_pct,0)/100.0))
                              + coalesce(pa.insumos_por_peca,0)
                       else null end
             when m.origem = 'importado' and imp.modelo_id is not null
                  then case when imp.oc_status = 'recebido'
                         -- [medios R16, R12 INFO 6] recebida sem landed real (NOT NULL DEFAULT 0: "sem" = 0) -> o
                         -- landed do card, nunca 0
                         then coalesce(nullif(imp.landed_real, 0), imp.landed, 0)
                       else null end
             when exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
               then coalesce((select materials + case when grade > 0 then servico_total / grade else 0 end
                                     + mo_prevista_sem_lancado
                              from mat where mat.modelo_id = m.id), 0)
                    + coalesce((select sum((c->>'valor')::numeric)
                               from jsonb_array_elements(coalesce(m.custos_adicionais,'[]'::jsonb)) c), 0)
             else coalesce(m.custo_peca_previsto,0)
           end,
    'mao_obra_previsto', coalesce((select sum(s.valor) from modelo_servico_mo s where s.modelo_id = m.id), 0),
    -- [medios R16 preco M7] M.O. embutida no 'real' = lancado / grade + prevista dos servicos sem lancado.
    'mao_obra_real', coalesce((select case when grade > 0 then servico_total / grade else 0 end + mo_prevista_sem_lancado
                                from mat where mat.modelo_id = m.id), 0),
    'confirmado', case when m.origem = 'revenda' and pa.modelo_id is not null
                     then coalesce(pa.oc_status = 'recebido', false)
                   when m.origem = 'importado' and imp.modelo_id is not null
                     then coalesce(imp.oc_status = 'recebido', false)
                   else exists(select 1 from cad_conf cc where cc.modelo_id = m.id) end
  )), '{}'::jsonb)
  into v_result
  from modelos m
  left join pa on pa.modelo_id = m.id
  left join imp on imp.modelo_id = m.id
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._dashboard_leadtime_itens_core(p_colecao uuid DEFAULT NULL::uuid, p_subcolecao text DEFAULT NULL::text, p_semana text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
  v_sla_servico text;  -- etapa cujo prazo vem do SLA da Sub1 (servicos | servico_cat:<id>)
  v_ultima text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  -- [medios R12, prod #7, P-185 A] a ULTIMA coluna do quadro e o ponto de chegada: NAO conta tempo.
  SELECT r.key INTO v_ultima FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord DESC LIMIT 1;
  SELECT leadtime->>'slaServico' INTO v_sla_servico FROM public.tenant_config WHERE tenant_id = v_tenant;

  WITH
  spans AS (
    SELECT m.id AS modelo_id, 'planejamento'::text AS etapa,
           (m.ordem_criacao_enviada_at::date - m.created_at::date)::numeric AS dias
      FROM public.modelos m
      WHERE m.tenant_id = v_tenant AND m.ordem_criacao_enviada_at IS NOT NULL
    UNION ALL
    -- COMPRA (revenda): OC feita → recebimento. Liga ocs_p_acabado → produtos_acabados → modelo.
    SELECT pa.modelo_id, 'compra', (oc.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_p_acabado oc
      JOIN public.produtos_acabados pa ON pa.id = oc.produto_acabado_id AND pa.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND oc.data_entrega IS NOT NULL AND pa.modelo_id IS NOT NULL
    UNION ALL
    -- COMPRA (importado): OC feita → recebimento (inclui trânsito/câmbio; etapas de câmbio são
    -- financeiras, sem marco de tempo próprio). Liga ocs_importado → produtos_importados → modelo.
    SELECT pi.modelo_id, 'compra', (oc.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_importado oc
      JOIN public.produtos_importados pi ON pi.id = oc.produto_importado_id AND pi.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND oc.data_entrega IS NOT NULL AND pi.modelo_id IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cad_corte', (c.data_enviado_corte - c.created_at::date)::numeric
      FROM public.cad c
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'servicos', (svc.dt - c.data_enviado_corte)::numeric
      FROM public.cad c
      JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL AND svc.dt IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cq', (q.confirmado_at::date - COALESCE(svc.dt, q.created_at::date))::numeric
      FROM public.controle_qualidade q
      JOIN public.cad c ON c.id = q.cad_id AND c.tenant_id = v_tenant
      LEFT JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'direcionamento', (c.direcionamento_confirmado_at::date - q.confirmado_at::date)::numeric
      FROM public.cad c
      JOIN public.controle_qualidade q ON q.cad_id = c.id
      WHERE c.tenant_id = v_tenant AND c.direcionamento_confirmado_at IS NOT NULL AND q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT m.id, 'lancamento', (m.data_lancamento - c.direcionamento_confirmado_at::date)::numeric
      FROM public.modelos m
      JOIN public.cad c ON c.modelo_id = m.id
      WHERE m.tenant_id = v_tenant AND m.data_lancamento IS NOT NULL AND c.direcionamento_confirmado_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'servico_cat:' || ct.id::text, (pt.data_entregue - pt.data_enviado)::numeric
      FROM public.producao_terceirizados pt
      JOIN public.cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
      JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
      WHERE pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL
    UNION ALL
    -- [medios R12, P-185 A] a ultima coluna do quadro NUNCA conta tempo (trecho aberto ou fechado). O lead() e calculado
  -- ANTES do filtro: a coluna anterior fecha quando o card ENTRA na ultima. Status fora do quadro atual seguem contando.
    SELECT h.modelo_id, 'kanban:' || h.status,
           (EXTRACT(EPOCH FROM (COALESCE(h.nxt, now()) - h.entrou_at)) / 86400.0)::numeric
      FROM (SELECT h0.modelo_id, h0.status, h0.entrou_at,
                   lead(h0.entrou_at) OVER (PARTITION BY h0.modelo_id ORDER BY h0.entrou_at) AS nxt
              FROM public.modelo_kanban_historico h0
             WHERE h0.tenant_id = v_tenant) h
      WHERE h.status IS DISTINCT FROM v_ultima
  ),
  per_etapa AS (
    SELECT modelo_id, etapa, ROUND(SUM(GREATEST(dias, 0)), 1) AS dias
      FROM spans GROUP BY modelo_id, etapa
  ),
  dur AS (
    SELECT modelo_id, jsonb_object_agg(etapa, dias) AS duracoes
      FROM per_etapa GROUP BY modelo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'modelo_id', m.id, 'ref', m.ref, 'nome', m.nome, 'versao', m.versao,
      'origem', COALESCE(m.origem, 'interno'),
      'colecao', COALESCE(col.nome, m.colecao), 'colecao_id', m.colecao_id,
      'subcolecao', m.subcolecao, 'semana', m.semana,
      'sub1_id', m.subcategoria1_id, 'sub1', s1.nome, 'sub1_sla', s1.sla_oficina,
      'duracoes', COALESCE(d.duracoes, '{}'::jsonb)
    ) ORDER BY COALESCE(col.nome, m.colecao) NULLS LAST, m.subcolecao NULLS LAST, m.semana NULLS LAST, m.ref NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM public.modelos m
  LEFT JOIN dur d ON d.modelo_id = m.id
  LEFT JOIN public.colecoes col ON col.id = m.colecao_id
  LEFT JOIN public.subcategorias1_produto s1 ON s1.id = m.subcategoria1_id
  WHERE m.tenant_id = v_tenant
    -- [medios R12, fix round 2] o card cujo UNICO historico e a ultima coluna (que nao conta tempo) continua na lista,
    -- com duracoes vazias: mesmo conjunto de cards de antes (todo card com historico tinha trecho de kanban).
    AND (d.modelo_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.modelo_kanban_historico hk WHERE hk.modelo_id = m.id AND hk.tenant_id = v_tenant))
    AND (p_colecao IS NULL OR m.colecao_id = p_colecao)
    AND (p_subcolecao IS NULL OR m.subcolecao = p_subcolecao)
    AND (p_semana IS NULL OR m.semana = p_semana);

  RETURN jsonb_build_object('itens', v_out, 'slaServico', v_sla_servico);
END;
$function$
;

CREATE OR REPLACE FUNCTION public._estoque_extrato_insumo_core(_tenant uuid, _etiqueta_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UM insumo, por bucket (tamanho, cor) = a chave da linha do _estoque_etiqueta_core (o bucket
-- da tela e da lib TS e (tamanho, nome da cor); core_* = a soma das linhas DISTINTAS do core com a mesma chave), so leitura. Mesmas
-- fontes e regras do core: item nao cancelado de OC Insumo 'recebido' (bucket da variante; recebida senao a pedida); por CAD enviado ao
-- PCP, a contribuicao ATUAL pela MESMA regra (enviar_por_tamanho preenchido = por tamanho; senao o "a enviar" inteiro repartido pela
-- grade planejada do CAD com _split_maior_resto, a fracao no bucket sem tamanho, quando o insumo tem tamanho; senao tudo sem tamanho)
-- vira a linha-base 'explosao' (C - Sigma ajustes, data/quem do envio) + uma linha 'explosao_ajuste' por transacao (txid) do
-- estoque_mov_log gravada DEPOIS do ultimo envio (antes/depois mapeados pela mesma regra com os pesos de HOJE - Ruling A19; delta
-- liquido <> 0); revenda/importado ainda nao enviado = consumo x pecas recebidas (_insumo_pecas: vinculado = so o tamanho; R1).
-- Sigma por bucket = recebido - baixa do core POR CONSTRUCAO (A17). Datas: OC Insumo sem audit = so a data de entrega (DIA =
-- meia-noite no fuso da loja); envio = audit (enviado_corte -> true) senao data_enviado_corte; revenda = data de entrega da OC de
-- P. Acabado/Importado recebida. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT d.tamanho AS tam, d.cor_nome AS cnome, SUM(d.recebido) AS rec, SUM(d.baixa) AS bx, SUM(d.fisico) AS fis
      FROM (SELECT DISTINCT x.tamanho, x.cor_nome, x.recebido, x.prev_receb, x.baixa, x.fisico
              FROM public._estoque_etiqueta_core(_tenant) x
             WHERE x.etiqueta_id = _etiqueta_id) d
     GROUP BY 1, 2
  ),
  etq AS (
    SELECT e.id, (COALESCE(e.formato_tamanho, 'ambos') <> 'nenhum'
                  AND EXISTS (SELECT 1 FROM public.variantes_etiqueta ve WHERE ve.etiqueta_id = e.id AND ve.tamanho IS NOT NULL)) AS com_tam
      FROM public.etiquetas e
     WHERE e.id = _etiqueta_id AND e.tenant_id = _tenant
       AND EXISTS (SELECT 1 FROM cr)
  ),
  oc0 AS (
    SELECT ve.tamanho AS tam, ve.cor_id AS cor, o.id AS oc_id, o.numero_pedido, o.data_entrega,
           COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) AS q
      FROM public.ocs_etiqueta_itens i
      JOIN public.ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant AND o.status = 'recebido'
      LEFT JOIN public.variantes_etiqueta ve ON ve.id = i.variante_etiqueta_id
     WHERE i.etiqueta_id = _etiqueta_id AND COALESCE(i.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM etq)
  ),
  ent AS (
    SELECT o.tam, o.cor,
           CASE WHEN o.data_entrega IS NOT NULL THEN (o.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN o.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'oc' AS org, o.q, NULL::text AS por, o.numero_pedido::text AS oc_ref, NULL::text AS mod_ref, o.oc_id AS rid, NULL::text AS det
      FROM oc0 o
  ),
  ce AS (
    SELECT ce.cad_id AS cad, ce.cor_id AS cor, COALESCE(ce.quantidade_enviar, 0) AS v, ce.enviar_por_tamanho AS ept
      FROM public.cad_etiquetas ce
      JOIN public.cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE ce.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  lg0 AS (
    SELECT l.id, l.cad_id AS cad, l.cor_id AS cor, l.txid, l.created_at, l.created_by, l.antes, l.depois, l.ept_antes, l.ept_depois
      FROM public.estoque_mov_log l
      JOIN public.cad c ON c.id = l.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE l.tenant_id = _tenant AND l.familia = 'insumo' AND l.item_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  cads AS (
    SELECT DISTINCT x.cad FROM (SELECT cad FROM ce UNION ALL SELECT cad FROM lg0) x
  ),
  pesos AS (  -- pesos de HOJE = grade planejada do CAD por tamanho (so com peca > 0), so se o insumo tem tamanho (regra do ce_sem)
    SELECT k.cad,
           CASE WHEN (SELECT e.com_tam FROM etq e)
                THEN (SELECT jsonb_object_agg(w.k, w.s)
                        FROM (SELECT kv.key AS k, sum((kv.value)::numeric) AS s
                                FROM public.cad_grades g
                                CROSS JOIN LATERAL jsonb_each_text(coalesce(g.grades_planejadas, '{}'::jsonb)) kv
                               WHERE g.cad_id = k.cad AND kv.value ~ '^[0-9]+(\.[0-9]+)?$'
                               GROUP BY kv.key
                              HAVING sum((kv.value)::numeric) > 0) w)
           END AS p
      FROM cads k
  ),
  contrib AS (
    SELECT r.cad, m.tam, r.cor, SUM(m.q) AS c
      FROM ce r
      LEFT JOIN pesos pe ON pe.cad = r.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) <> '{}'::jsonb THEN r.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND r.v >= 1
                                    THEN public._split_maior_resto(floor(r.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND r.v >= 1 THEN r.v - floor(r.v) ELSE r.v END
         WHERE coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
     GROUP BY 1, 2, 3
  ),
  aud_cad AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT k.cad FROM cads k)
       AND al.tenant_id = _tenant AND al.tabela = 'cad' AND al.acao = 'editar'
       AND al.dados -> 'enviado_corte' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  envio AS (
    SELECT k.cad,
           CASE WHEN ac.registro_id IS NOT NULL THEN ac.created_at
                WHEN c.data_enviado_corte IS NOT NULL THEN (c.data_enviado_corte::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ac.registro_id IS NOT NULL THEN 'registro' WHEN c.data_enviado_corte IS NOT NULL THEN 'data_envio'
                ELSE 'sem_data' END AS fonte,
           ac.user_nome AS por,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref
      FROM cads k
      JOIN public.cad c ON c.id = k.cad
      LEFT JOIN aud_cad ac ON ac.registro_id = k.cad
      LEFT JOIN public.modelos m ON m.id = c.modelo_id AND m.tenant_id = _tenant
  ),
  lgm AS (  -- cada lado do log mapeado para (tamanho) pela regra do core com os pesos de HOJE; depois - antes
    SELECT x.id, x.cad, m.tam, x.cor, x.txid, x.created_at, x.created_by, m.q * x.sinal AS d
      FROM (SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.depois AS v, l.ept_depois AS ept, 1 AS sinal
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd
            UNION ALL
            SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.antes, l.ept_antes, -1
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd) x
      LEFT JOIN pesos pe ON pe.cad = x.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) <> '{}'::jsonb THEN x.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND x.v >= 1
                                    THEN public._split_maior_resto(floor(x.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND x.v >= 1 THEN x.v - floor(x.v) ELSE x.v END
         WHERE coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
  ),
  lg AS (
    SELECT l.cad, l.tam, l.cor, l.txid, SUM(l.d) AS d, max(l.created_at) AS qd,
           (array_agg(l.created_by ORDER BY l.created_at DESC, l.id DESC))[1] AS por_id
      FROM lgm l
     GROUP BY 1, 2, 3, 4
    HAVING SUM(l.d) <> 0
  ),
  base AS (
    SELECT k.cad, k.tam, k.cor,
           COALESCE(ct.c, 0) - COALESCE((SELECT SUM(g.d) FROM lg g
                                          WHERE g.cad = k.cad AND g.tam IS NOT DISTINCT FROM k.tam AND g.cor IS NOT DISTINCT FROM k.cor), 0) AS b
      FROM (SELECT cad, tam, cor FROM contrib UNION SELECT cad, tam, cor FROM lg) k
      LEFT JOIN contrib ct ON ct.cad = k.cad AND ct.tam IS NOT DISTINCT FROM k.tam AND ct.cor IS NOT DISTINCT FROM k.cor
  ),
  sai_cad AS (
    SELECT b.tam, b.cor, e.qd, e.fonte, 'explosao' AS org, -b.b AS q, e.por::text AS por, NULL::text AS oc_ref, e.mod_ref, b.cad AS rid,
           NULL::text AS det
      FROM base b JOIN envio e ON e.cad = b.cad
    UNION ALL
    SELECT g.tam, g.cor, g.qd, 'registro', 'explosao_ajuste', -g.d, u.nome::text, NULL::text, e.mod_ref, g.cad, NULL::text
      FROM lg g JOIN envio e ON e.cad = g.cad
      LEFT JOIN public.users u ON u.id = g.por_id
  ),
  rev0 AS (  -- a MESMA baixa_revenda do core (revenda/importado ainda nao enviado ao PCP, pecas recebidas do cad-espelho)
    SELECT m.id AS modelo, m.origem AS m_origem, COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, c.id AS cad, me.cor_id AS cor,
           sum(me.consumo * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(c.id, true),
                                                 coalesce(cg.total_real, 0))) AS q
      FROM public.modelo_etiquetas me
      JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = _tenant AND m.origem IN ('revenda', 'importado')
      JOIN public.cad c ON c.modelo_id = m.id AND c.tenant_id = _tenant AND NOT coalesce(c.enviado_corte, false)
      JOIN LATERAL (SELECT g.cad_id, sum(g.grade_total_real) AS total_real FROM public.cad_grades g WHERE g.cad_id = c.id GROUP BY g.cad_id) cg
        ON true
     WHERE me.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
     GROUP BY 1, 2, 3, 4, 5
  ),
  rev_oc AS (
    SELECT DISTINCT ON (r.modelo) r.modelo, x.numero, x.data_entrega
      FROM rev0 r
      JOIN LATERAL (
        SELECT o.numero::text AS numero, o.data_entrega, o.created_at
          FROM public.ocs_p_acabado o JOIN public.produtos_acabados pa ON pa.id = o.produto_acabado_id
         WHERE r.m_origem = 'revenda' AND pa.modelo_id = r.modelo AND o.tenant_id = _tenant AND o.status = 'recebido'
        UNION ALL
        SELECT o.numero::text, o.data_entrega, o.created_at
          FROM public.ocs_importado o JOIN public.produtos_importados pi ON pi.id = o.produto_importado_id
         WHERE r.m_origem = 'importado' AND pi.modelo_id = r.modelo AND o.tenant_id = _tenant AND o.status = 'recebido'
      ) x ON true
     ORDER BY r.modelo, x.data_entrega DESC NULLS LAST, x.created_at DESC
  ),
  sai_rev AS (
    SELECT NULL::text AS tam, r.cor,
           CASE WHEN ro.data_entrega IS NOT NULL THEN (ro.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ro.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'revenda' AS org, -r.q AS q, NULL::text AS por, ro.numero AS oc_ref, r.mod_ref, r.cad AS rid, NULL::text AS det
      FROM rev0 r
      LEFT JOIN rev_oc ro ON ro.modelo = r.modelo
  ),
  sai_pt AS (  -- [urg r11c] baixa da PECA TESTE (ledger estoque_peca_teste_baixas, familia 'insumo'): 1 linha por registro, bucket
               -- (tamanho, cor_id) da propria linha. baixa = saida negativa; estorno = entrada positiva (q = -quantidade). mod_ref =
               -- REF/nome do card VIVO (tentativa -> modelo) senao NULL; det = rotulo; quem = users.nome do created_by.
    SELECT b.tamanho AS tam, b.cor_id AS cor, b.created_at AS qd, 'registro' AS fonte, b.origem AS org,
           -b.quantidade AS q, u.nome::text AS por, NULL::text AS oc_ref,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, b.id AS rid, NULLIF(btrim(b.rotulo), '') AS det
      FROM public.estoque_peca_teste_baixas b
      LEFT JOIN public.users u ON u.id = b.created_by
      LEFT JOIN public.modelo_peca_teste_tentativas pt ON pt.id = b.tentativa_id
      LEFT JOIN public.modelos m ON m.id = pt.modelo_id AND m.tenant_id = _tenant
     WHERE b.tenant_id = _tenant AND b.familia = 'insumo' AND b.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM sai_cad UNION ALL SELECT * FROM sai_rev UNION ALL SELECT * FROM sai_pt
  )
  SELECT NULL::uuid, cr.tam, mov.cor, cr.cnome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, mov.det,
         cr.rec, cr.bx, cr.fis
    FROM mov
    LEFT JOIN public.cores co ON co.id = mov.cor
    JOIN cr ON cr.tam IS NOT DISTINCT FROM mov.tam AND cr.cnome IS NOT DISTINCT FROM co.nome
   WHERE mov.q <> 0
   ORDER BY cr.tam NULLS FIRST, cr.cnome NULLS FIRST, mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_modelo_espelho_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- P-137 A (R1): coluna a coluna — cada uma so vai ao produto quando ELA mudou no card nesta escrita.
  -- P-145 A (R3b): NULL do card nunca e copiado (categoria nem subs).
  v_cat boolean := OLD.categoria_principal_id IS DISTINCT FROM NEW.categoria_principal_id;
  v_s1 boolean := NEW.subcategoria1_id IS NOT NULL AND OLD.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id;
  v_s2 boolean := NEW.subcategoria2_id IS NOT NULL AND OLD.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id;
  v_grupo uuid;
  r record;
  v_g uuid;
  v_c uuid;
  v_n1 uuid;
  v_n2 uuid;
BEGIN
  -- Card sem categoria (passo intermediario da troca de grupo no Sheet): o produto fica como esta.
  IF NEW.categoria_principal_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- P-143 A: o grupo vem da categoria nova. Categoria sem grupo (ou de outra loja) -> nao copia nada (R3a).
  SELECT c.grupo_id INTO v_grupo
    FROM public.categorias_produto c
   WHERE c.id = NEW.categoria_principal_id AND c.tenant_id = NEW.tenant_id;
  IF v_grupo IS NULL OR NOT (v_cat OR v_s1 OR v_s2) THEN
    RETURN NULL;
  END IF;

  -- Cada produto espelho (1:1 por gatilho, nao por UNIQUE — por isso o laco cobre todas as linhas) travado FOR UPDATE:
  -- serializa com um INSERT de OC concorrente (a FK dele pede KEY SHARE nesta linha).
  FOR r IN
    SELECT 'produtos_acabados'::text AS tabela, pa.id, pa.grupo_id, pa.categoria_id, pa.subcategoria1_id AS s1, pa.subcategoria2_id AS s2
      FROM public.produtos_acabados pa
     WHERE NEW.origem = 'revenda' AND pa.modelo_id = NEW.id AND pa.tenant_id = NEW.tenant_id
       FOR UPDATE
  LOOP
    -- P-142 B: produto com pedido nao troca entre Acessorios e outro grupo (grade UN x grade por tamanho).
    IF v_cat AND r.grupo_id IS DISTINCT FROM v_grupo
       AND public._grupo_eh_acessorio(r.grupo_id) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
       AND (EXISTS (SELECT 1 FROM public.ocs_p_acabado o WHERE r.tabela = 'produtos_acabados' AND o.produto_acabado_id = r.id)
         OR EXISTS (SELECT 1 FROM public.ocs_importado o WHERE r.tabela = 'produtos_importados' AND o.produto_importado_id = r.id)) THEN
      RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
        USING ERRCODE = 'P0001';
    END IF;
    v_g := CASE WHEN v_cat THEN v_grupo ELSE r.grupo_id END;
    v_c := CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE r.categoria_id END;
    -- Sub (H1/M1 do G-migration): a sub do card vai ao produto quando mudou E pertence ao contexto certo — junto com a
    -- categoria copiada, ou (troca SO da sub) quando o produto ja esta na MESMA categoria do card (senao seria sub de
    -- outra categoria). Categoria copiada e sub do card vazia: a sub do produto fica SE ainda pertence a categoria
    -- nova; se nao pertence, e limpa (nunca sub orfa de outra categoria).
    v_n1 := CASE
      WHEN v_s1 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria1_id
      WHEN v_cat AND r.s1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias1_produto s
                                                      WHERE s.id = r.s1 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s1 END;
    v_n2 := CASE
      WHEN v_s2 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria2_id
      WHEN v_cat AND r.s2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias2_produto s
                                                      WHERE s.id = r.s2 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s2 END;
    IF (v_g, v_c, v_n1, v_n2) IS DISTINCT FROM (r.grupo_id, r.categoria_id, r.s1, r.s2) THEN
      UPDATE public.produtos_acabados
         SET grupo_id = v_g, categoria_id = v_c, subcategoria1_id = v_n1, subcategoria2_id = v_n2, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;

  FOR r IN
    SELECT 'produtos_importados'::text AS tabela, pi.id, pi.grupo_id, pi.categoria_id, pi.subcategoria1_id AS s1, pi.subcategoria2_id AS s2
      FROM public.produtos_importados pi
     WHERE NEW.origem = 'importado' AND pi.modelo_id = NEW.id AND pi.tenant_id = NEW.tenant_id
       FOR UPDATE
  LOOP
    -- P-142 B: produto com pedido nao troca entre Acessorios e outro grupo (grade UN x grade por tamanho).
    IF v_cat AND r.grupo_id IS DISTINCT FROM v_grupo
       AND public._grupo_eh_acessorio(r.grupo_id) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
       AND (EXISTS (SELECT 1 FROM public.ocs_p_acabado o WHERE r.tabela = 'produtos_acabados' AND o.produto_acabado_id = r.id)
         OR EXISTS (SELECT 1 FROM public.ocs_importado o WHERE r.tabela = 'produtos_importados' AND o.produto_importado_id = r.id)) THEN
      RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
        USING ERRCODE = 'P0001';
    END IF;
    v_g := CASE WHEN v_cat THEN v_grupo ELSE r.grupo_id END;
    v_c := CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE r.categoria_id END;
    -- Sub (H1/M1 do G-migration): a sub do card vai ao produto quando mudou E pertence ao contexto certo — junto com a
    -- categoria copiada, ou (troca SO da sub) quando o produto ja esta na MESMA categoria do card (senao seria sub de
    -- outra categoria). Categoria copiada e sub do card vazia: a sub do produto fica SE ainda pertence a categoria
    -- nova; se nao pertence, e limpa (nunca sub orfa de outra categoria).
    v_n1 := CASE
      WHEN v_s1 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria1_id
      WHEN v_cat AND r.s1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias1_produto s
                                                      WHERE s.id = r.s1 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s1 END;
    v_n2 := CASE
      WHEN v_s2 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria2_id
      WHEN v_cat AND r.s2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias2_produto s
                                                      WHERE s.id = r.s2 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s2 END;
    IF (v_g, v_c, v_n1, v_n2) IS DISTINCT FROM (r.grupo_id, r.categoria_id, r.s1, r.s2) THEN
      UPDATE public.produtos_importados
         SET grupo_id = v_g, categoria_id = v_c, subcategoria1_id = v_n1, subcategoria2_id = v_n2, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
  RETURN NULL;
END
$function$
;

-- DROP das 7 funcoes NOVAS da T2 (nao existiam antes da R13): 3 wrappers + 3 cores + applier.
DROP FUNCTION IF EXISTS public.receber_item_oc_p_acabado(uuid,uuid,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public._receber_item_oc_p_acabado_core(uuid,uuid,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public.salvar_oc_p_acabado_itens(uuid,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public._salvar_oc_p_acabado_itens_core(uuid,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public.fazer_pedido_p_acabado(jsonb);
DROP FUNCTION IF EXISTS public._fazer_pedido_p_acabado_core(jsonb);
DROP FUNCTION IF EXISTS public._ocpa_aplicar_derivados(uuid);

-- ============================ T3 (Produto Importado): restaura os corpos de ANTES + DROP das RPCs novas ============================
CREATE OR REPLACE FUNCTION public._salvar_oc_importado_core(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_importado
        where id = _id and tenant_id = v_tenant for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
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
      desconto_pct, cotacao_final, data_nota_entrada
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
      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0), nullif(_dados->>'data_nota_entrada', '')::date
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
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
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
  -- [leves L8, P-207 A + Q1] etapa de MERCADORIA (base vazia = mercadoria) com % > 0 e cotacao <= 0 vira parcela 0 e
  -- _gerar_parcelas_importado a pula em silencio (fin #10): recusa - SO quando a compra tem valor (valor_unitario_m1 > 0;
  -- Q2). Mesma regra do card (_salvar_produto_importado_core) e da tela (erroCotacaoEtapas). Frete com 0 = identidade.
  if v_valor_unitario_m1 > 0 and exists(select 1 from jsonb_array_elements(v_etapas) e
             where coalesce(nullif(e->>'base',''),'mercadoria') = 'mercadoria'
               and coalesce(nullif(e->>'percentual','')::numeric, 0) > 0
               and coalesce(nullif(e->>'cotacao','')::numeric, 0) <= 0) then
    raise exception 'Informe a cotacao da etapa de mercadoria (percentual maior que zero e cotacao zerada).' using errcode = 'P0001';
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
end $function$
;

CREATE OR REPLACE FUNCTION public._receber_oc_importado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public._excluir_oc_importado_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    raise exception 'nao_encontrado: oc' using errcode = 'P0002';
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
end $function$
;

CREATE OR REPLACE FUNCTION public._excluir_produto_importado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_modelo_id uuid; v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  select modelo_id into v_modelo_id from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'Produto não encontrado'; end if;
  -- Guarda de OC (fechada agora — Fase 2 já criou ocs_importado): bloqueia excluir com OC ativa.
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_importado where produto_importado_id = _produto_id and tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de excluir.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;
  delete from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  -- o modelo espelho (se houver) vira modelo comum (modelo_id já é on delete set null); NÃO apaga.
end $function$
;

CREATE OR REPLACE FUNCTION public._limpar_produto_importado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_modelo_id uuid;
  v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select modelo_id into v_modelo_id from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'nao_encontrado: produto' using errcode = 'P0002'; end if;
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_importado where produto_importado_id = _produto_id and tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de limpar.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;

  -- Zera escalares + câmbio; PRESERVA id/colecao_id/subcolecao/ref/mix_id/modelo_id(null).
  -- moeda_compra/intermediaria voltam ao DEFAULT do emptyDraft (RMB/USD) — mantém o banco COERENTE
  -- com o reset do front (que parte de emptyDraft) e respeita o NOT NULL de moeda_compra.
  update public.produtos_importados set
    nome = '',
    grupo_id = null, categoria_id = null, subcategoria1_id = null, subcategoria2_id = null,
    semana = null, empresa_id = null, representante_id = null,
    ref_fornecedor = null, composicao = null, foto_url = null,
    data_pedido = null, data_prevista = null, data_entrega = null,
    grade_proporcao = '{}'::jsonb, qtd_total = 0,
    moeda_compra = 'RMB', moeda_intermediaria = 'USD',
    valor_unitario_m1 = 0, cotacao_ref = 0, peso_kg = 0, transporte_m2 = 0,
    desconto_pct = 0, cotacao_final = 0, markup_atacado = null, markup_varejo = null,
    tamanho_tipo = null,  -- [tamanho-em v1]
    categoria_tecido_id = null, material_aviamento_id = null,  -- [i3 v1] (ruling do controlador)
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_importado_variantes where produto_importado_id = _produto_id;
  delete from public.produto_importado_etapas where produto_importado_id = _produto_id;
end $function$
;

CREATE OR REPLACE FUNCTION public._imp_etapas_brl_oc(_oc_id uuid)
 RETURNS TABLE(ordem integer, rotulo text, base text, data_vencimento date, valor_brl numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_desc numeric;
  v_merc_liq_m1 numeric;
  v_frete_liq_m2 numeric;
  v_tem_etapa_frete boolean;
  v_prox_ordem int;
begin
  select valor_unitario_m1, qtd_total, peso_kg, transporte_m2, desconto_pct, cotacao_final, data_pedido
    into o from public.ocs_importado where id = _oc_id;
  if not found or coalesce(o.qtd_total,0) <= 0 then
    return;
  end if;
  v_desc := 1 - coalesce(o.desconto_pct,0) / 100.0;
  v_merc_liq_m1 := coalesce(o.valor_unitario_m1,0) * o.qtd_total * v_desc;
  v_frete_liq_m2 := coalesce(o.peso_kg,0) * coalesce(o.transporte_m2,0) * o.qtd_total * v_desc;

  -- etapas reais
  return query
  select e.ordem, e.rotulo::text, e.base::text, e.data_vencimento,
    round(
      case
        when e.base = 'mercadoria' then
          case when coalesce(e.cotacao,0) > 0
            then (v_merc_liq_m1 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else 0 end
        else -- frete: já em M2
          case when coalesce(e.cotacao,0) > 0 and e.cotacao <> 1
            then (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) end
      end * coalesce(o.cotacao_final,0)
    , 2) as valor_brl
  from public.ocs_importado_etapas e
  where e.oc_importado_id = _oc_id
  order by e.ordem;

  -- Frete IMPLÍCITO: há frete mas nenhuma etapa de frete → emite 100% do frete (sem conversão,
  -- já em M2), espelhando o fallback do _imp_custo_landed. Vence na data do pedido.
  select exists(select 1 from public.ocs_importado_etapas ie where ie.oc_importado_id = _oc_id and ie.base = 'frete')
    into v_tem_etapa_frete;
  if not v_tem_etapa_frete and v_frete_liq_m2 > 0 then
    select coalesce(max(ie.ordem),0)+1 into v_prox_ordem from public.ocs_importado_etapas ie where ie.oc_importado_id = _oc_id;
    return query select v_prox_ordem, 'Frete'::text, 'frete'::text, o.data_pedido,
      round(v_frete_liq_m2 * coalesce(o.cotacao_final,0), 2);
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public._imp_recalcular_landed_real_oc(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_qtd int; v_total_brl numeric;
begin
  select qtd_total into v_qtd from public.ocs_importado where id = _oc_id;
  if coalesce(v_qtd,0) <= 0 then
    update public.ocs_importado set custo_unitario_landed_real = 0 where id = _oc_id;
    return;
  end if;
  select coalesce(sum(valor_brl),0) into v_total_brl from public._imp_etapas_brl_oc(_oc_id);
  update public.ocs_importado
    set custo_unitario_landed_real = round(v_total_brl / v_qtd, 4)
    where id = _oc_id;
end $function$
;

-- DROP das 8 funcoes NOVAS da T3 (nao existiam antes da R13): 4 wrappers + 4 cores + 2 helpers.
DROP FUNCTION IF EXISTS public.vincular_oc_importado(uuid,uuid);
DROP FUNCTION IF EXISTS public._vincular_oc_importado_core(uuid,uuid);
DROP FUNCTION IF EXISTS public.receber_item_oc_importado(uuid,uuid,jsonb,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public._receber_item_oc_importado_core(uuid,uuid,jsonb,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public.salvar_oc_importado_itens(uuid,jsonb,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public._salvar_oc_importado_itens_core(uuid,jsonb,jsonb,jsonb,integer);
DROP FUNCTION IF EXISTS public.fazer_pedido_importado(jsonb);
DROP FUNCTION IF EXISTS public._fazer_pedido_importado_core(jsonb);
DROP FUNCTION IF EXISTS public._oci_copiar_etapas_do_produto(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public._oci_aplicar_derivados(uuid);

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
