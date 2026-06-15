-- Update recalcular_parcelas + triggers to use parcelas_recebimento as source of truth
-- and relax authorization to tenant isolation only.

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
  v_parcelas_recebimento jsonb;
  v_use_checklist boolean := false;
  v_existentes_pagas integer := 0;
  v_deletadas integer := 0;
  v_criadas integer := 0;
  v_data_item date;
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
           COALESCE(valor_real_total,0), COALESCE(parcelas_recebimento, '[]'::jsonb)
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_valor_total, v_parcelas_recebimento
    FROM public.ocs_tecido WHERE id = _oc_id;
  ELSE
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1),
           COALESCE(parcelas_recebimento, '[]'::jsonb)
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_parcelas_recebimento
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

  -- Autorização: tenant da OC (ou super_admin pode cruzar tenants)
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;

  -- Decide fonte da verdade
  IF jsonb_typeof(v_parcelas_recebimento) = 'array' AND jsonb_array_length(v_parcelas_recebimento) > 0 THEN
    v_use_checklist := true;
    v_n_parcelas := LEAST(GREATEST(jsonb_array_length(v_parcelas_recebimento), 1), 24);
  ELSE
    v_n_parcelas := GREATEST(v_quantidade_prazos, 1);
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

  v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
  v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
  v_base_data := COALESCE(v_data_entrega, CURRENT_DATE);

  FOR i IN 1..v_n_parcelas LOOP
    -- Pula número de parcela se já existe (pago preservado)
    IF EXISTS (
      SELECT 1 FROM public.parcelas
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id)
          OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id))
        AND numero_parcela = i
    ) THEN
      CONTINUE;
    END IF;

    -- Vencimento
    IF v_use_checklist THEN
      v_data_item := NULL;
      BEGIN
        v_data_item := NULLIF(v_parcelas_recebimento->(i-1)->>'data', '')::date;
      EXCEPTION WHEN OTHERS THEN
        v_data_item := NULL;
      END;
      v_vencimento := COALESCE(v_data_item, v_base_data + (i * 30));
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
    'fonte', CASE WHEN v_use_checklist THEN 'checklist' ELSE 'quantidade_prazos' END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.recalcular_parcelas(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_parcelas(uuid, text) TO authenticated;

-- Trigger: OC tecido
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
  v_parcelas jsonb;
  v_use_checklist boolean := false;
  v_data_item date;
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_tecido_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    v_parcelas := COALESCE(NEW.parcelas_recebimento, '[]'::jsonb);
    IF jsonb_typeof(v_parcelas) = 'array' AND jsonb_array_length(v_parcelas) > 0 THEN
      v_use_checklist := true;
      v_n_parcelas := LEAST(GREATEST(jsonb_array_length(v_parcelas), 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    v_valor_total := COALESCE(NEW.valor_real_total, 0);
    v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
    v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..v_n_parcelas LOOP
      IF v_use_checklist THEN
        v_data_item := NULL;
        BEGIN
          v_data_item := NULLIF(v_parcelas->(i-1)->>'data', '')::date;
        EXCEPTION WHEN OTHERS THEN
          v_data_item := NULL;
        END;
        v_vencimento := COALESCE(v_data_item, v_base_data + (i * 30));
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

-- Trigger: OC aviamento
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
  v_parcelas jsonb;
  v_use_checklist boolean := false;
  v_data_item date;
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_aviamento_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    v_parcelas := COALESCE(NEW.parcelas_recebimento, '[]'::jsonb);
    IF jsonb_typeof(v_parcelas) = 'array' AND jsonb_array_length(v_parcelas) > 0 THEN
      v_use_checklist := true;
      v_n_parcelas := LEAST(GREATEST(jsonb_array_length(v_parcelas), 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    SELECT COALESCE(SUM(COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) * COALESCE(a.preco, 0)), 0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens i
    LEFT JOIN public.aviamentos a ON a.id = i.aviamento_id
    WHERE i.oc_aviamento_id = NEW.id;

    v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
    v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
    v_base_data := COALESCE(NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..v_n_parcelas LOOP
      IF v_use_checklist THEN
        v_data_item := NULL;
        BEGIN
          v_data_item := NULLIF(v_parcelas->(i-1)->>'data', '')::date;
        EXCEPTION WHEN OTHERS THEN
          v_data_item := NULL;
        END;
        v_vencimento := COALESCE(v_data_item, v_base_data + (i * 30));
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