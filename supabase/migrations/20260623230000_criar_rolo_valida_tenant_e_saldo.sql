-- _criar_rolo_core não validava nada da origem:
--   * cross-tenant: um tenant podia passar _origem_item_id (ou _artigo_id) de OUTRO
--     tenant e a baixa separacao_rolo referenciava o item alheio → sabotagem do
--     estoque exibido da outra loja (alto de segurança).
--   * sem saldo: a separação podia exceder o disponível da origem → físico negativo.
-- Adiciona: validação de posse por tenant (artigo e origem) e a trava de saldo do
-- padrão _remover_metragem_oc_core (saldo_oc_item_m), acumulando o separado no loop.

CREATE OR REPLACE FUNCTION public._criar_rolo_core(_codigo text, _artigo_id uuid, _variantes jsonb, _origem_item_id uuid DEFAULT NULL::uuid, _rua text DEFAULT NULL::text, _prateleira text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rolo_id uuid;
  v_unidade text;
  v_rend numeric;
  v_item jsonb;
  v_var uuid;
  v_metragem numeric;
  v_qtd numeric;
  v_saldo_origem numeric;
  v_sep_total numeric := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT unidade_medida, COALESCE(rendimento,0) INTO v_unidade, v_rend
  FROM public.artigos WHERE id = _artigo_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Artigo não pertence à loja'; END IF;

  -- Separar de outra OC/rolo: valida posse da origem pelo tenant e captura o saldo
  -- disponível, p/ não separar mais do que existe (físico negativo / cross-tenant).
  IF _origem_item_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ocs_tecido_itens it
      JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
      WHERE it.id = _origem_item_id AND oc.tenant_id = v_tenant
    ) THEN
      RAISE EXCEPTION 'Item de origem não pertence à loja';
    END IF;
    SELECT saldo_m INTO v_saldo_origem FROM public.saldo_oc_item_m(_origem_item_id);
  END IF;

  INSERT INTO public.ocs_tecido (tenant_id, is_rolo, rolo_codigo, rolo_origem_item_id,
                                 rolo_rua, rolo_prateleira,
                                 status, data_pedido, data_entrega, numero_pedido)
  VALUES (v_tenant, true, _codigo, _origem_item_id,
          NULLIF(_rua,''), NULLIF(_prateleira,''),
          'recebido', current_date, current_date,
          COALESCE(NULLIF(_codigo,''), 'ROLO'))
  RETURNING id INTO v_rolo_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes, '[]'::jsonb)) LOOP
    v_var := NULLIF(v_item->>'variante_tecido_id','')::uuid;
    v_metragem := COALESCE((v_item->>'metragem')::numeric, 0);
    IF v_var IS NULL OR v_metragem <= 0 THEN CONTINUE; END IF;

    v_qtd := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN v_metragem / v_rend ELSE v_metragem END;

    INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id,
                                         quantidade_pedida, quantidade_recebida)
    VALUES (v_rolo_id, _artigo_id, v_var, v_qtd, v_qtd);

    IF _origem_item_id IS NOT NULL THEN
      v_sep_total := v_sep_total + v_metragem;
      IF v_sep_total > COALESCE(v_saldo_origem, 0) + 1e-6 THEN
        RAISE EXCEPTION 'Só há % m disponíveis na origem (tentou separar % m).',
          round(COALESCE(v_saldo_origem, 0), 2), round(v_sep_total, 2);
      END IF;
      INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id,
                                                variante_tecido_id, quantidade, origem, rolo_id)
      VALUES (v_tenant, NULL, _origem_item_id, v_var, v_metragem, 'separacao_rolo', v_rolo_id);
    END IF;
  END LOOP;

  RETURN v_rolo_id;
END;
$function$;
