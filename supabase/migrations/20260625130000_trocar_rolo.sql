-- Troca de um ROLO defeituoso (modo Só Rolo), sem mexer em financeiro (rolo não tem
-- parcela — por isso NÃO usa aplicar_resolucao_alerta_tecido, que recalcula parcelas).
-- Fluxo: reverte a separação do rolo defeituoso (devolve a metragem à OC de origem),
-- marca o rolo como 'trocado' (cancelado, sai do estoque) e cria um rolo de REPOSIÇÃO
-- (novo código automático) a partir da mesma origem, com a metragem informada (ou a
-- mesma do defeituoso). Retorna o id do rolo novo.
CREATE OR REPLACE FUNCTION public._trocar_rolo_core(_rolo_id uuid, _nova_metragem numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem uuid;
  v_artigo uuid;
  v_variante uuid;
  v_metros numeric;
  v_unidade text;
  v_rend numeric;
  v_saldo numeric;
  v_codigo text;
  v_new_rolo uuid;
  v_qtd numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT tenant_id, rolo_origem_item_id INTO v_tenant, v_origem
  FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;
  IF v_origem IS NULL THEN
    RAISE EXCEPTION 'Rolo sem origem (não foi separado de uma OC) — troca indisponível.';
  END IF;

  SELECT artigo_id, variante_tecido_id INTO v_artigo, v_variante
  FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id LIMIT 1;

  -- Metragem (metros) da separação do rolo defeituoso.
  SELECT quantidade INTO v_metros
  FROM public.estoque_tecido_baixas
  WHERE rolo_id = _rolo_id AND origem = 'separacao_rolo' LIMIT 1;
  v_metros := COALESCE(_nova_metragem, v_metros, 0);
  IF v_metros <= 0 THEN RAISE EXCEPTION 'Metragem do rolo de reposição inválida.'; END IF;

  -- Reverte a separação do defeituoso (devolve metragem à origem) e o marca trocado.
  DELETE FROM public.estoque_tecido_baixas WHERE rolo_id = _rolo_id;
  UPDATE public.ocs_tecido_itens
     SET cancelado = true, cq_alerta_status = 'trocado'
   WHERE oc_tecido_id = _rolo_id;

  -- Saldo da origem após a devolução: não separar mais do que existe.
  SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(v_origem);
  IF v_metros > COALESCE(v_saldo, 0) + 1e-6 THEN
    RAISE EXCEPTION 'Só há % m disponíveis na OC de origem (reposição pediu % m).',
      round(COALESCE(v_saldo, 0), 2), round(v_metros, 2);
  END IF;

  -- Cria o rolo de reposição (novo código) a partir da mesma origem.
  SELECT unidade_medida, COALESCE(rendimento, 0) INTO v_unidade, v_rend
  FROM public.artigos WHERE id = v_artigo;
  v_codigo := public.proximo_codigo_rolo(v_artigo);
  v_qtd := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN v_metros / v_rend ELSE v_metros END;

  INSERT INTO public.ocs_tecido (tenant_id, is_rolo, rolo_codigo, rolo_origem_item_id,
                                 status, data_pedido, data_entrega, numero_pedido)
  VALUES (v_tenant, true, v_codigo, v_origem, 'recebido', current_date, current_date, v_codigo)
  RETURNING id INTO v_new_rolo;

  INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id,
                                       quantidade_pedida, quantidade_recebida)
  VALUES (v_new_rolo, v_artigo, v_variante, v_qtd, v_qtd);

  INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id,
                                            variante_tecido_id, quantidade, origem, rolo_id)
  VALUES (v_tenant, NULL, v_origem, v_variante, v_metros, 'separacao_rolo', v_new_rolo);

  RETURN v_new_rolo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trocar_rolo(_rolo_id uuid, _nova_metragem numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  RETURN public._trocar_rolo_core(_rolo_id, _nova_metragem);
END $function$;

REVOKE EXECUTE ON FUNCTION public._trocar_rolo_core(uuid, numeric) FROM public, anon, authenticated;
