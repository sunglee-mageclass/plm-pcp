-- Financeiro: as parcelas (contas a PAGAR ao fornecedor) passam a ser geradas
-- pelo PRAZO DE PAGAMENTO da OC (ex.: "30/60/90"), e não mais pela quantidade
-- de parcelas de RECEBIMENTO (entrega da mercadoria).
--
-- Antes: as 3 funções (gerar_parcelas_oc_tecido, gerar_parcelas_oc_aviamento e
-- recalcular_parcelas) usavam parcelas_recebimento como nº de parcelas de
-- pagamento — confundindo recebimento (quando a mercadoria chega) com prazo
-- (quando se paga o fornecedor). Agora:
--   • nº de parcelas = nº de prazos do prazo_pagamento (fallback quantidade_prazos)
--   • vencimento da parcela i = data_entrega + (dia i do prazo)  [fallback i*30]
--   • parcelas_recebimento deixa de influenciar o financeiro.

-- ===== Trigger: OC de Tecido =====
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
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_tecido_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    -- Dias de cada prazo a partir de prazo_pagamento (ex.: "30/60/90" -> {30,60,90}).
    v_dias := ARRAY(
      SELECT t::int
      FROM regexp_split_to_table(COALESCE(NEW.prazo_pagamento, ''), '[^0-9]+') AS t
      WHERE t ~ '^[0-9]+$'
    );
    IF array_length(v_dias, 1) >= 1 THEN
      v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    v_valor_total := COALESCE(NEW.valor_real_total, 0);
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

      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_tecido_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        NEW.tenant_id, 'tecido', NEW.id, NEW.empresa_id,
        i, v_valor_a_inserir, v_vencimento, 'a_pagar'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== Trigger: OC de Aviamento =====
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

    v_dias := ARRAY(
      SELECT t::int
      FROM regexp_split_to_table(COALESCE(NEW.prazo_pagamento, ''), '[^0-9]+') AS t
      WHERE t ~ '^[0-9]+$'
    );
    IF array_length(v_dias, 1) >= 1 THEN
      v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco, 0)), 0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = NEW.id;

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

      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_aviamento_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        NEW.tenant_id, 'aviamento', NEW.id, NEW.empresa_id,
        i, v_valor_a_inserir, v_vencimento, 'a_pagar'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- ===== RPC: recalcular parcelas (preserva as pagas) =====
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
  v_valor_ultima numeric(12,2);
  v_base_data date;
  v_empresa uuid;
  v_data_entrega date;
  v_quantidade_prazos integer;
  v_prazo_pagamento text;
  v_dias integer[];
  v_existentes_pagas integer := 0;
  v_deletadas integer := 0;
  v_criadas integer := 0;
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN
    RAISE EXCEPTION 'tipo deve ser tecido ou aviamento';
  END IF;

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

  -- nº de parcelas (pagamento) = nº de prazos do prazo_pagamento (fallback quantidade_prazos)
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

  -- Preservar parcelas pagas
  SELECT COUNT(*) INTO v_existentes_pagas
  FROM public.parcelas
  WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
      OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
    AND (status = 'pago' OR data_pagamento IS NOT NULL);

  WITH del AS (
    DELETE FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
        OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
      AND status IS DISTINCT FROM 'pago'
      AND data_pagamento IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deletadas FROM del;

  v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
  v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
  v_base_data := COALESCE(v_data_entrega, CURRENT_DATE);

  FOR i IN 1..v_n_parcelas LOOP
    IF EXISTS (
      SELECT 1 FROM public.parcelas
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
          OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
        AND numero_parcela = i
    ) THEN
      CONTINUE;
    END IF;

    IF array_length(v_dias, 1) >= i THEN
      v_vencimento := v_base_data + v_dias[i];
    ELSE
      v_vencimento := v_base_data + (i * 30);
    END IF;

    v_valor_a_inserir := CASE WHEN i = v_n_parcelas THEN v_valor_ultima ELSE v_valor_parcela END;

    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_tecido_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        v_tenant, 'tecido', _oc_id, v_empresa,
        i, v_valor_a_inserir, v_vencimento, 'a_pagar'
      );
    ELSE
      INSERT INTO public.parcelas (
        tenant_id, tipo_oc, oc_aviamento_id, empresa_id,
        numero_parcela, valor, data_vencimento, status
      ) VALUES (
        v_tenant, 'aviamento', _oc_id, v_empresa,
        i, v_valor_a_inserir, v_vencimento, 'a_pagar'
      );
    END IF;
    v_criadas := v_criadas + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'preservadas_pagas', v_existentes_pagas,
    'deletadas', v_deletadas,
    'criadas', v_criadas,
    'valor_total', v_valor_total,
    'valor_parcela', v_valor_parcela,
    'fonte', 'prazo_pagamento'
  );
END;
$function$;
