-- Fase 3 / Onda 3b (parte 2) — Merge de conflito colaborativo na OC Produto Importado.
-- IDÊNTICO em estrutura ao P.Acabado (20260916150000): a grade é `grade_detalhe` jsonb NA RAIZ
-- (não tabela filha) e as etapas de pagamento (`ocs_importado_etapas`) são estado COMPLETO
-- delete+reinsert (sem chave estável) — então no FRONT o merge é mergeDraft (cabeçalho, com as
-- etapas como array GRÃO-GROSSO num campo do draft) + mergeGradeGenerico (grade por célula
-- pedida/recebida/defeito). NÃO precisa do trigger de bump-da-filha: o UPDATE da raiz já bumpa o
-- rev, e as etapas são reescritas na MESMA txn do UPDATE da raiz (o save é atômico). RLS do SELECT
-- de ocs_importado já corrigida em 20260916140000 (modgate_oci_sel removido — Realtime lê como
-- authenticated).
--
-- Peças:
--   1. rev em ocs_importado + trigger BEFORE UPDATE fn_colab_touch_rev (genérica).
--   2. _salvar_oc_importado_core + `_rev_base integer DEFAULT NULL` (trava FOR UPDATE + P0409) +
--      wrapper salvar_oc_importado overload de 5 args.
--
-- Diff-validar _salvar_oc_importado_core antes/depois: só ADICIONA _rev_base + trava (validações de
-- grade/qtd/congelamento, etapas Σ%=100, INSERT/UPDATE, landed real INTACTOS).

BEGIN;

-- ── 1. rev na raiz + trigger de bump ──────────────────────────────────────────
ALTER TABLE public.ocs_importado ADD COLUMN IF NOT EXISTS rev integer NOT NULL DEFAULT 0;

DROP TRIGGER IF EXISTS trg_colab_rev_oc_imp ON public.ocs_importado;
CREATE TRIGGER trg_colab_rev_oc_imp
  BEFORE UPDATE ON public.ocs_importado
  FOR EACH ROW EXECUTE FUNCTION public.fn_colab_touch_rev();

-- ── 2. _salvar_oc_importado_core + _rev_base ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._salvar_oc_importado_core(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL)
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
end $function$;

REVOKE EXECUTE ON FUNCTION public._salvar_oc_importado_core(uuid, jsonb, jsonb, jsonb, integer) FROM public, anon, authenticated;

-- Wrapper com _rev_base (o de 4 args segue existindo p/ retrocompat).
CREATE OR REPLACE FUNCTION public.salvar_oc_importado(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb, _rev_base integer)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._salvar_oc_importado_core(_id, _dados, _grade, _etapas, _rev_base);
END;
$function$;

COMMIT;
