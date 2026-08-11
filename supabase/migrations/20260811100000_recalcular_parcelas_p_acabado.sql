-- FF1b (fast-follow Revenda, ago/2026): estende o "Recalcular" manual do Financeiro
-- (ParcelaDetailDialog) pra parcelas de Produto Acabado (`tipo_oc='p_acabado'`). Hoje
-- `recalcular_parcelas`/`_recalcular_parcelas_core` só aceitam 'tecido'/'aviamento' —
-- clicar Recalcular numa parcela de p_acabado dava "Parcela sem OC vinculada" (ocId
-- vinha null no front).
--
-- Decisão: extensão MECÂNICA. `gerar_parcelas_oc_p_acabado` (trigger em ocs_p_acabado,
-- migração 20260807160000) já foi escrita pra ESPELHAR `_recalcular_parcelas_core`
-- (ver CLAUDE.md invariante 13: "netam contra as já pagas — espelha
-- _recalcular_parcelas_core... usar o _core como referência ao tocar essa família").
-- Aqui fechamos o círculo: o _core ganha um 3º ramo que lê de `ocs_p_acabado` com a
-- MESMA matemática do trigger (mesmo delete-e-reinsere só dos slots não-pagos, mesmo
-- rateio com resto no último slot inserido) — REUSA a fórmula compartilhada
-- (v_dias/v_n_parcelas/rateio) em vez de duplicá-la, então tecido/aviamento/p_acabado
-- convergem pro mesmo cálculo por construção; não há dois caminhos divergentes.
--
-- Duas diferenças de fonte (não de fórmula), espelhando exatamente o trigger:
--   - total = `valor_total_desconto` (não `valor_real_total`/soma de itens);
--   - data-base do cronograma = `data_pedido` (não `data_entrega` — ocs_p_acabado não
--     tem conceito de "entrega parcial"/prazo por item como tecido/aviamento).
-- `ocs_p_acabado` não tem coluna `quantidade_prazos`; deixamos v_quantidade_prazos NULL
-- nesse ramo — o fallback existente `GREATEST(v_quantidade_prazos, 1)` já ignora NULL
-- (GREATEST/LEAST do Postgres pulam NULL) e cai em 1, igual ao fallback `array[30]` do
-- trigger (mesmo resultado por caminhos equivalentes, verificado).
--
-- Insumo (etiqueta) FICA DE FORA (não é o escopo desta FF): tem gerador próprio
-- (`recalcular_parcelas_etiqueta`, função separada sem wrapper de auth) já com o mesmo
-- padrão de auto-recálculo via trigger; o front esconde o botão Recalcular pra esse tipo
-- (mudança só de UI, sem trigger nova aqui).

CREATE OR REPLACE FUNCTION public._recalcular_parcelas_core(_oc_id uuid, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_n_parcelas integer;
  v_valor_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_base_data date;
  v_empresa uuid;
  -- Data-base do cronograma: `data_entrega` p/ tecido/aviamento, `data_pedido` p/
  -- p_acabado (nome do campo mantido pra não alterar o resto da função).
  v_data_entrega date;
  v_quantidade_prazos integer;
  v_prazo_pagamento text;
  v_dias integer[];
  v_existentes_pagas integer := 0;
  v_pago_total numeric(12,2) := 0;
  v_deletadas integer := 0;
  v_criadas integer := 0;
  v_n_inserir integer := 0;
  v_restante_valor numeric(12,2);
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  v_idx integer := 0;
  i integer;
BEGIN
  IF _tipo = 'tecido' AND EXISTS (SELECT 1 FROM public.ocs_tecido WHERE id = _oc_id AND COALESCE(is_rolo,false)) THEN
    RETURN jsonb_build_object('ok', true, 'rolo', true);
  END IF;
  IF _tipo NOT IN ('tecido','aviamento','p_acabado') THEN
    RAISE EXCEPTION 'tipo deve ser tecido, aviamento ou p_acabado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_oc_id::text));

  IF _tipo = 'tecido' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1),
           prazo_pagamento, COALESCE(valor_real_total,0)
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total
    FROM public.ocs_tecido WHERE id = _oc_id;
  ELSIF _tipo = 'aviamento' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento
    FROM public.ocs_aviamento WHERE id = _oc_id;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco,0)),0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = _oc_id
      AND COALESCE(it.cancelado, false) = false;
  ELSE
    -- p_acabado: espelha gerar_parcelas_oc_p_acabado (base=data_pedido, total=valor_total_desconto).
    SELECT tenant_id, empresa_id, data_pedido, prazo_pagamento, COALESCE(valor_total_desconto,0)
      INTO v_tenant, v_empresa, v_data_entrega, v_prazo_pagamento, v_valor_total
    FROM public.ocs_p_acabado WHERE id = _oc_id;
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;

  v_dias := ARRAY(
    SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo_pagamento, ''), '[^0-9]+') AS t WHERE t ~ '^[0-9]+$'
  );
  IF array_length(v_dias, 1) >= 1 THEN
    v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
  ELSE
    v_n_parcelas := GREATEST(v_quantidade_prazos, 1);
  END IF;

  SELECT COUNT(*), COALESCE(SUM(valor),0)
    INTO v_existentes_pagas, v_pago_total
  FROM public.parcelas
  WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
    AND (status = 'pago' OR data_pagamento IS NOT NULL);

  WITH del AS (
    DELETE FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
      AND status IS DISTINCT FROM 'pago' AND data_pagamento IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deletadas FROM del;

  SELECT COUNT(*) INTO v_n_inserir
  FROM generate_series(1, v_n_parcelas) g(i)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
      AND numero_parcela = g.i
  );

  v_restante_valor := v_valor_total - v_pago_total;

  IF v_valor_total <= 0 OR v_restante_valor <= 0 OR v_n_inserir = 0 THEN
    RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
      'deletadas',v_deletadas,'criadas',0,'valor_total',v_valor_total,
      'restante',GREATEST(v_restante_valor,0),'fonte','prazo_pagamento');
  END IF;

  v_valor_parcela := ROUND(v_restante_valor / v_n_inserir, 2);
  v_base_data := COALESCE(v_data_entrega, CURRENT_DATE);

  FOR i IN 1..v_n_parcelas LOOP
    IF EXISTS (SELECT 1 FROM public.parcelas
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
        AND numero_parcela = i) THEN
      CONTINUE;
    END IF;
    v_idx := v_idx + 1;
    IF array_length(v_dias, 1) >= i THEN v_vencimento := v_base_data + v_dias[i];
    ELSE v_vencimento := v_base_data + (i * 30); END IF;
    v_valor_a_inserir := CASE WHEN v_idx = v_n_inserir
      THEN v_restante_valor - v_valor_parcela * (v_n_inserir - 1) ELSE v_valor_parcela END;
    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (v_tenant, 'tecido', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    ELSIF _tipo = 'aviamento' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (v_tenant, 'aviamento', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    ELSE
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_p_acabado_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (v_tenant, 'p_acabado', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END IF;
    v_criadas := v_criadas + 1;
  END LOOP;

  RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
    'deletadas',v_deletadas,'criadas',v_criadas,'valor_total',v_valor_total,
    'valor_parcela',v_valor_parcela,'fonte','prazo_pagamento');
END;
$function$;

-- Re-REVOKE defensivo (invariante 9 — CREATE OR REPLACE preserva ACL, mas o padrão do
-- projeto é restatar sempre que o _core é redefinido).
REVOKE EXECUTE ON FUNCTION public._recalcular_parcelas_core(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recalcular_parcelas(_oc_id uuid, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _tipo NOT IN ('tecido','aviamento','p_acabado') THEN
    RAISE EXCEPTION 'tipo deve ser tecido, aviamento ou p_acabado';
  END IF;
  IF _tipo = 'tecido' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _oc_id;
  ELSIF _tipo = 'aviamento' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_aviamento WHERE id = _oc_id;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.ocs_p_acabado WHERE id = _oc_id;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;
  RETURN public._recalcular_parcelas_core(_oc_id, _tipo);
END;
$function$;
