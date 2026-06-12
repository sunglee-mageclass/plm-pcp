CREATE OR REPLACE FUNCTION public.recalcular_parcelas(_oc_id uuid, _tipo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_is_admin boolean;
  v_n_parcelas integer;
  v_valor_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_base_data date;
  v_empresa uuid;
  v_data_entrega date;
  v_quantidade_prazos integer;
  v_existentes_pagas integer := 0;
  v_deletadas integer := 0;
  v_criadas integer := 0;
  i integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN
    RAISE EXCEPTION 'tipo deve ser tecido ou aviamento';
  END IF;

  -- Buscar dados da OC + tenant
  IF _tipo = 'tecido' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), COALESCE(valor_real_total,0)
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_valor_total
    FROM public.ocs_tecido WHERE id = _oc_id;
  ELSE
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1)
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos
    FROM public.ocs_aviamento WHERE id = _oc_id;

    SELECT COALESCE(SUM(COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) * COALESCE(a.preco,0)),0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens i
    LEFT JOIN public.aviamentos a ON a.id = i.aviamento_id
    WHERE i.oc_aviamento_id = _oc_id;
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;

  -- Autorização: tenant_admin do tenant da OC OU super_admin
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user AND role IN ('super_admin','tenant_admin','admin')
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Apenas administradores podem recalcular parcelas';
  END IF;

  IF v_is_admin AND NOT public.is_super_admin() THEN
    IF v_tenant <> public.get_user_tenant_id() THEN
      RAISE EXCEPTION 'Sem permissão para esta OC';
    END IF;
  END IF;

  -- Contar parcelas pagas (preservar)
  SELECT COUNT(*) INTO v_existentes_pagas
  FROM public.parcelas
  WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
      OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
    AND (status = 'pago' OR data_pagamento IS NOT NULL);

  -- Deletar não-pagas
  WITH del AS (
    DELETE FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
        OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
      AND status IS DISTINCT FROM 'pago'
      AND data_pagamento IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deletadas FROM del;

  v_n_parcelas := GREATEST(v_quantidade_prazos, 1);
  v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
  v_base_data := COALESCE(v_data_entrega, CURRENT_DATE);

  FOR i IN 1..v_n_parcelas LOOP
    -- Pula número de parcela se já existe pago com esse número
    IF EXISTS (
      SELECT 1 FROM public.parcelas
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
          OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
        AND numero_parcela = i
    ) THEN
      CONTINUE;
    END IF;

    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_tecido_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        v_tenant, 'tecido', _oc_id, v_empresa,
        i, v_valor_parcela, v_base_data + (i * 30), 'a_pagar'
      );
    ELSE
      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_aviamento_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        v_tenant, 'aviamento', _oc_id, v_empresa,
        i, v_valor_parcela, v_base_data + (i * 30), 'a_pagar'
      );
    END IF;
    v_criadas := v_criadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'preservadas_pagas', v_existentes_pagas,
    'deletadas', v_deletadas,
    'criadas', v_criadas,
    'valor_total', v_valor_total,
    'valor_parcela', v_valor_parcela
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalcular_parcelas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_parcelas(uuid, text) TO authenticated;