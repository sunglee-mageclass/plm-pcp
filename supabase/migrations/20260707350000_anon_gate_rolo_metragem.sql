-- MÉDIO (diagnóstico OC Tecido): _criar_rolo_core e _remover_metragem_oc_core barravam anon
-- só por efeito colateral (get_user_tenant_id() devolve sentinela nil, não NULL, então o
-- lookup por tenant não achava o artigo/item). Frágil a refactor. Adiciona checagem EXPLÍCITA
-- de autenticação no topo, igual aos outros _core de rolo (cancelar/reabrir/ajustar/trocar).
-- _criar_rolo_core: + checagem explícita de auth
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
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

-- _remover_metragem_oc_core: + checagem explícita de auth
CREATE OR REPLACE FUNCTION public._remover_metragem_oc_core(_oc_tecido_item_id uuid, _metragem numeric, _motivo text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_var uuid;
  v_saldo numeric;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF _metragem IS NULL OR _metragem <= 0 THEN RAISE EXCEPTION 'Metragem inválida'; END IF;

  SELECT it.variante_tecido_id INTO v_var
  FROM public.ocs_tecido_itens it
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
  WHERE it.id = _oc_tecido_item_id AND oc.tenant_id = v_tenant;
  IF v_var IS NULL THEN RAISE EXCEPTION 'Item não encontrado ou sem variante'; END IF;

  SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(_oc_tecido_item_id);
  IF _metragem > COALESCE(v_saldo, 0) + 1e-6 THEN
    RAISE EXCEPTION 'Só há % m disponíveis nessa OC.', round(COALESCE(v_saldo, 0), 2);
  END IF;

  INSERT INTO public.estoque_tecido_baixas
    (tenant_id, cad_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem, rolo_id, motivo, created_by)
  VALUES
    (v_tenant, NULL, _oc_tecido_item_id, v_var, _metragem, 'ajuste', NULL, NULLIF(_motivo, ''), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

select pg_notify('pgrst','reload schema');
