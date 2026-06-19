-- BLOCO C — resolução de alerta de tecido (cancelar / troca / estilo_ok / reabrir),
-- recomputando valor + parcelas (corrige o bug de cancelar sem recalcular parcelas).
-- _acao: 'cancelar' | 'estilo_ok' | 'reabrir' | 'troca'.
-- Na troca, adiciona o item substituto (a receber) e +1 no cronograma de recebimento.
CREATE OR REPLACE FUNCTION public.aplicar_resolucao_alerta_tecido(
  _item_id uuid,
  _acao text,
  _rep_artigo_id uuid DEFAULT NULL::uuid,
  _rep_variante_id uuid DEFAULT NULL::uuid,
  _rep_metragem numeric DEFAULT NULL::numeric
) RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_oc uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT it.oc_tecido_id INTO v_oc
  FROM public.ocs_tecido_itens it
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
  WHERE it.id = _item_id AND oc.tenant_id = v_tenant;
  IF v_oc IS NULL THEN RAISE EXCEPTION 'Item não encontrado'; END IF;

  IF _acao = 'cancelar' THEN
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'cancelado', cancelado = true WHERE id = _item_id;
  ELSIF _acao = 'estilo_ok' THEN
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'estilo_ok', cancelado = false WHERE id = _item_id;
  ELSIF _acao = 'reabrir' THEN
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'alertado', cancelado = false WHERE id = _item_id;
  ELSIF _acao = 'troca' THEN
    IF _rep_artigo_id IS NULL OR _rep_variante_id IS NULL THEN
      RAISE EXCEPTION 'Informe o tecido/variante substituto';
    END IF;
    -- original sai (trocado)
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'trocado', cancelado = true WHERE id = _item_id;
    -- substituto entra a RECEBER (quantidade_recebida NULL)
    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, substitui_item_id, cq_alerta_status)
    VALUES
      (v_oc, _rep_artigo_id, _rep_variante_id, COALESCE(_rep_metragem, 0), NULL, _item_id, 'sem_alerta');
    -- +1 no cronograma de RECEBIMENTO (entrega), pendente
    UPDATE public.ocs_tecido
       SET parcelas_recebimento = COALESCE(parcelas_recebimento, '[]'::jsonb)
                                  || jsonb_build_array(jsonb_build_object('data', '', 'recebido', false))
     WHERE id = v_oc;
  ELSE
    RAISE EXCEPTION 'Ação inválida: %', _acao;
  END IF;

  -- Recomputa os totais da OC (exclui cancelados), igual ao save da OC.
  UPDATE public.ocs_tecido oc SET
    valor_real_total = COALESCE((
      SELECT SUM(COALESCE(it.quantidade_recebida, 0) * COALESCE(a.preco, 0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id = it.artigo_id
      WHERE it.oc_tecido_id = oc.id AND COALESCE(it.cancelado, false) = false), 0),
    valor_previsto_total = COALESCE((
      SELECT SUM(COALESCE(it.quantidade_pedida, 0) * COALESCE(a.preco, 0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id = it.artigo_id
      WHERE it.oc_tecido_id = oc.id AND COALESCE(it.cancelado, false) = false), 0)
  WHERE oc.id = v_oc;

  -- Recalcula as parcelas A PAGAR (só as não pagas).
  PERFORM public.recalcular_parcelas(v_oc, 'tecido');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aplicar_resolucao_alerta_tecido(uuid, text, uuid, uuid, numeric) FROM anon;
