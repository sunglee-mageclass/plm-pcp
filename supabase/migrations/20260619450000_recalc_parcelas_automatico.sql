-- 4b: tornar a recalc de parcelas AUTOMÁTICA (garantida no banco) + sanear o histórico.
--   1) Refatora recalcular_parcelas em _recalcular_parcelas_core (lógica, sem auth)
--      + wrapper público recalcular_parcelas (auth/permissão -> core).
--   2) Trigger em ocs_tecido: OC já recebida com valor_real_total alterado
--      (troca/cancelamento/edição) recalcula sozinha. Não dispara no recebimento
--      inicial (aí quem cria é gerar_parcelas_oc_tecido).
--   3) Backfill: roda o core em todas as OCs com gap (corrige o histórico no deploy).

-- 1a) CORE: a lógica de recálculo, sem checagem de auth (uso interno/trigger/backfill).
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
  IF _tipo NOT IN ('tecido','aviamento') THEN
    RAISE EXCEPTION 'tipo deve ser tecido ou aviamento';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_oc_id::text));

  IF _tipo = 'tecido' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1),
           prazo_pagamento, COALESCE(valor_real_total,0)
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total
    FROM public.ocs_tecido WHERE id = _oc_id;
  ELSE
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento
    FROM public.ocs_aviamento WHERE id = _oc_id;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco,0)),0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = _oc_id;
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
  WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
    AND (status = 'pago' OR data_pagamento IS NOT NULL);

  WITH del AS (
    DELETE FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
      AND status IS DISTINCT FROM 'pago' AND data_pagamento IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deletadas FROM del;

  SELECT COUNT(*) INTO v_n_inserir
  FROM generate_series(1, v_n_parcelas) g(i)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
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
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
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
    ELSE
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (v_tenant, 'aviamento', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END IF;
    v_criadas := v_criadas + 1;
  END LOOP;

  RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
    'deletadas',v_deletadas,'criadas',v_criadas,'valor_total',v_valor_total,
    'valor_parcela',v_valor_parcela,'fonte','prazo_pagamento');
END;
$function$;

-- core não deve ser chamável diretamente por clientes (ignora permissão de tenant).
REVOKE EXECUTE ON FUNCTION public._recalcular_parcelas_core(uuid, text) FROM public, anon, authenticated;

-- 1b) WRAPPER público: auth + permissão de tenant -> core.
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
  IF _tipo NOT IN ('tecido','aviamento') THEN
    RAISE EXCEPTION 'tipo deve ser tecido ou aviamento';
  END IF;
  IF _tipo = 'tecido' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _oc_id;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.ocs_aviamento WHERE id = _oc_id;
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

-- 2) TRIGGER: OC tecido já recebida com valor_real_total alterado -> recalc automático.
CREATE OR REPLACE FUNCTION public.recalc_parcelas_on_valor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'recebido' AND OLD.status = 'recebido'
     AND NOT COALESCE(NEW.is_rolo, false)
     AND NEW.valor_real_total IS DISTINCT FROM OLD.valor_real_total THEN
    PERFORM public._recalcular_parcelas_core(NEW.id, 'tecido');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_parcelas_valor ON public.ocs_tecido;
CREATE TRIGGER trg_recalc_parcelas_valor
  AFTER UPDATE OF valor_real_total ON public.ocs_tecido
  FOR EACH ROW EXECUTE FUNCTION public.recalc_parcelas_on_valor();

-- 3) BACKFILL: corrige o histórico (todas as OCs com gap) no deploy.
DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT o.id FROM public.ocs_tecido o
    WHERE NOT COALESCE(o.is_rolo,false)
      AND EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_tecido_id = o.id)
      AND ABS(COALESCE(o.valor_real_total,0) - (SELECT COALESCE(SUM(p.valor),0) FROM public.parcelas p WHERE p.oc_tecido_id = o.id)) > 0.01
  LOOP
    PERFORM public._recalcular_parcelas_core(r.id, 'tecido');
  END LOOP;

  FOR r IN
    SELECT o.id FROM public.ocs_aviamento o
    WHERE EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_aviamento_id = o.id)
      AND ABS(
            (SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida,it.quantidade_pedida,0)*COALESCE(a.preco,0)),0)
               FROM public.ocs_aviamento_itens it LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
              WHERE it.oc_aviamento_id = o.id)
            - (SELECT COALESCE(SUM(p.valor),0) FROM public.parcelas p WHERE p.oc_aviamento_id = o.id)
          ) > 0.01
  LOOP
    PERFORM public._recalcular_parcelas_core(r.id, 'aviamento');
  END LOOP;
END;
$backfill$;
