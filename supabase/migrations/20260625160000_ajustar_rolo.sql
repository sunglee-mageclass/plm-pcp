-- Ajusta a QUANTIDADE de um rolo já criado (recebido). Atualiza o item do rolo
-- (quantidade) e a baixa de separação na origem (metros). _nova_qtd vem na unidade do
-- artigo (kg ou m), igual ao campo no destrinchamento; o metros da separação é
-- derivado (kg→m via rendimento). Sem checagem de saldo (metragem livre, como na
-- troca); bloqueia se o rolo já foi consumido adiante.
CREATE OR REPLACE FUNCTION public._ajustar_rolo_core(_rolo_id uuid, _nova_qtd numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_item uuid;
  v_artigo uuid;
  v_unidade text;
  v_rend numeric;
  v_metros numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _nova_qtd IS NULL OR _nova_qtd <= 0 THEN RAISE EXCEPTION 'Quantidade do rolo inválida.'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;

  SELECT id, artigo_id INTO v_item, v_artigo
  FROM public.ocs_tecido_itens WHERE oc_tecido_id = _rolo_id LIMIT 1;
  IF v_item IS NULL THEN RAISE EXCEPTION 'Item do rolo não encontrado'; END IF;

  IF EXISTS (SELECT 1 FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = v_item) THEN
    RAISE EXCEPTION 'Rolo já em uso — desfaça o uso antes de ajustar a quantidade.';
  END IF;

  SELECT unidade_medida, COALESCE(rendimento, 0) INTO v_unidade, v_rend
  FROM public.artigos WHERE id = v_artigo;
  v_metros := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN _nova_qtd * v_rend ELSE _nova_qtd END;

  UPDATE public.ocs_tecido_itens
     SET quantidade_recebida = _nova_qtd, quantidade_pedida = _nova_qtd
   WHERE oc_tecido_id = _rolo_id;

  -- Atualiza a metragem separada da origem (se houver).
  UPDATE public.estoque_tecido_baixas
     SET quantidade = v_metros
   WHERE rolo_id = _rolo_id AND origem = 'separacao_rolo';
END;
$function$;

CREATE OR REPLACE FUNCTION public.ajustar_rolo(_rolo_id uuid, _nova_qtd numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._ajustar_rolo_core(_rolo_id, _nova_qtd);
END $function$;

REVOKE EXECUTE ON FUNCTION public._ajustar_rolo_core(uuid, numeric) FROM public, anon, authenticated;
