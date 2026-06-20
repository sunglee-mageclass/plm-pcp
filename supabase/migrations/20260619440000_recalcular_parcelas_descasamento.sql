-- P0-4: recalcular_parcelas descasava a soma das parcelas de valor_real_total.
-- A função dividia o TOTAL CHEIO por n (valor_total/n) e recriava as não-pagas
-- com essa cota, mantendo as pagas com o valor antigo -> Σ parcelas <> valor_real
-- (ex.: OC com troca após pagamento, gap de R$ 51k).
--
-- Correção: distribui (valor_total - Σ pagas) APENAS sobre as parcelas a inserir
-- (as não-pagas), a última absorve o resto do arredondamento -> Σ = valor_total.
-- + advisory lock por OC (troca/reposição chamam a recalc em sequência).
-- + guard valor_total<=0 nos 2 triggers de geração (não gera parcela R$ 0,00).

CREATE OR REPLACE FUNCTION public.recalcular_parcelas(_oc_id uuid, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
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
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _tipo = 'tecido' AND EXISTS (SELECT 1 FROM public.ocs_tecido WHERE id = _oc_id AND COALESCE(is_rolo,false)) THEN
    RETURN jsonb_build_object('ok', true, 'rolo', true);
  END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN
    RAISE EXCEPTION 'tipo deve ser tecido ou aviamento';
  END IF;

  -- Serializa recálculos concorrentes da mesma OC.
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
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;

  -- nº de parcelas = nº de prazos do prazo_pagamento (fallback quantidade_prazos)
  v_dias := ARRAY(
    SELECT t::int
    FROM regexp_split_to_table(COALESCE(v_prazo_pagamento, ''), '[^0-9]+') AS t
    WHERE t ~ '^[0-9]+$'
  );
  IF array_length(v_dias, 1) >= 1 THEN
    v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
  ELSE
    v_n_parcelas := GREATEST(v_quantidade_prazos, 1);
  END IF;

  -- Pagas preservadas: conta E soma o valor já alocado.
  SELECT COUNT(*), COALESCE(SUM(valor),0)
    INTO v_existentes_pagas, v_pago_total
  FROM public.parcelas
  WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
      OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
    AND (status = 'pago' OR data_pagamento IS NOT NULL);

  -- Remove só as não-pagas.
  WITH del AS (
    DELETE FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
        OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
      AND status IS DISTINCT FROM 'pago'
      AND data_pagamento IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deletadas FROM del;

  -- Quantas das parcelas 1..n faltam (as pagas que sobraram ocupam seus números).
  SELECT COUNT(*) INTO v_n_inserir
  FROM generate_series(1, v_n_parcelas) g(i)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
        OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
      AND numero_parcela = g.i
  );

  v_restante_valor := v_valor_total - v_pago_total;

  -- Nada a (re)criar: OC zerada, já pago tudo/mais, ou sem slots livres.
  IF v_valor_total <= 0 OR v_restante_valor <= 0 OR v_n_inserir = 0 THEN
    RETURN jsonb_build_object(
      'preservadas_pagas', v_existentes_pagas,
      'pago_total', v_pago_total,
      'deletadas', v_deletadas,
      'criadas', 0,
      'valor_total', v_valor_total,
      'restante', GREATEST(v_restante_valor, 0),
      'fonte', 'prazo_pagamento'
    );
  END IF;

  -- Distribui o RESTANTE (total - pago) sobre as parcelas a inserir.
  v_valor_parcela := ROUND(v_restante_valor / v_n_inserir, 2);
  v_base_data := COALESCE(v_data_entrega, CURRENT_DATE);

  FOR i IN 1..v_n_parcelas LOOP
    IF EXISTS (
      SELECT 1 FROM public.parcelas
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
          OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
        AND numero_parcela = i
    ) THEN
      CONTINUE;  -- parcela paga preservada
    END IF;

    v_idx := v_idx + 1;

    IF array_length(v_dias, 1) >= i THEN
      v_vencimento := v_base_data + v_dias[i];
    ELSE
      v_vencimento := v_base_data + (i * 30);
    END IF;

    -- A última a inserir absorve o resto do arredondamento.
    v_valor_a_inserir := CASE
      WHEN v_idx = v_n_inserir THEN v_restante_valor - v_valor_parcela * (v_n_inserir - 1)
      ELSE v_valor_parcela END;

    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (v_tenant, 'tecido', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    ELSE
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (v_tenant, 'aviamento', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END IF;
    v_criadas := v_criadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'preservadas_pagas', v_existentes_pagas,
    'pago_total', v_pago_total,
    'deletadas', v_deletadas,
    'criadas', v_criadas,
    'valor_total', v_valor_total,
    'valor_parcela', v_valor_parcela,
    'fonte', 'prazo_pagamento'
  );
END;
$function$;


-- Triggers de geração: guard de valor_total <= 0 (não gera parcela R$ 0,00).
CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n_parcelas integer;
  v_valor_parcela numeric(12,2);
  v_valor_ultima numeric(12,2);
  v_valor_total numeric(12,2);
  v_base_data date;
  v_dias integer[];
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF COALESCE(NEW.is_rolo, false) THEN RETURN NEW; END IF;
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_tecido_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    v_valor_total := COALESCE(NEW.valor_real_total, 0);
    IF v_valor_total <= 0 THEN
      RETURN NEW;  -- OC sem valor (ex.: itens cancelados) não gera parcela.
    END IF;

    v_dias := ARRAY(
      SELECT t::int FROM regexp_split_to_table(COALESCE(NEW.prazo_pagamento, ''), '[^0-9]+') AS t
      WHERE t ~ '^[0-9]+$'
    );
    IF array_length(v_dias, 1) >= 1 THEN
      v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
    v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..v_n_parcelas LOOP
      IF array_length(v_dias, 1) >= i THEN
        v_vencimento := v_base_data + v_dias[i];
      ELSE
        v_vencimento := v_base_data + (i * 30);
      END IF;
      v_valor_a_inserir := CASE WHEN i = v_n_parcelas THEN v_valor_ultima ELSE v_valor_parcela END;
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (NEW.tenant_id, 'tecido', NEW.id, NEW.empresa_id, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_aviamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n_parcelas integer;
  v_valor_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_valor_ultima numeric(12,2);
  v_base_data date;
  v_dias integer[];
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_aviamento_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco, 0)), 0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = NEW.id;

    IF v_valor_total <= 0 THEN
      RETURN NEW;  -- OC sem valor não gera parcela.
    END IF;

    v_dias := ARRAY(
      SELECT t::int FROM regexp_split_to_table(COALESCE(NEW.prazo_pagamento, ''), '[^0-9]+') AS t
      WHERE t ~ '^[0-9]+$'
    );
    IF array_length(v_dias, 1) >= 1 THEN
      v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
    v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..v_n_parcelas LOOP
      IF array_length(v_dias, 1) >= i THEN
        v_vencimento := v_base_data + v_dias[i];
      ELSE
        v_vencimento := v_base_data + (i * 30);
      END IF;
      v_valor_a_inserir := CASE WHEN i = v_n_parcelas THEN v_valor_ultima ELSE v_valor_parcela END;
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (NEW.tenant_id, 'aviamento', NEW.id, NEW.empresa_id, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
