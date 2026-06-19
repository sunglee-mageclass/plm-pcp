-- Troca em duas etapas: na troca o original vira 'troca_pendente' (badge "Troca");
-- ao receber a reposição (data + metragem), vira 'trocado' (badge "Trocado") e o
-- valor/parcelas sobem de volta.

-- 1) aplicar_resolucao: troca passa a deixar o original em 'troca_pendente'.
CREATE OR REPLACE FUNCTION public.aplicar_resolucao_alerta_tecido(
  _item_id uuid, _acao text,
  _rep_artigo_id uuid DEFAULT NULL::uuid, _rep_variante_id uuid DEFAULT NULL::uuid, _rep_metragem numeric DEFAULT NULL::numeric
) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_oc uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT it.oc_tecido_id INTO v_oc FROM public.ocs_tecido_itens it
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
    IF _rep_artigo_id IS NULL OR _rep_variante_id IS NULL THEN RAISE EXCEPTION 'Informe o tecido/variante substituto'; END IF;
    UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'troca_pendente', cancelado = true WHERE id = _item_id;
    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, substitui_item_id, cq_alerta_status)
    VALUES (v_oc, _rep_artigo_id, _rep_variante_id, COALESCE(_rep_metragem, 0), NULL, _item_id, 'sem_alerta');
    UPDATE public.ocs_tecido
       SET parcelas_recebimento = COALESCE(parcelas_recebimento, '[]'::jsonb)
                                  || jsonb_build_array(jsonb_build_object('data', '', 'recebido', false))
     WHERE id = v_oc;
  ELSE
    RAISE EXCEPTION 'Ação inválida: %', _acao;
  END IF;

  UPDATE public.ocs_tecido oc SET
    valor_real_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_recebida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0),
    valor_previsto_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_pedida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0)
  WHERE oc.id = v_oc;
  PERFORM public.recalcular_parcelas(v_oc, 'tecido');
END;
$function$;

-- 2) Receber a reposição: marca a reposição recebida (data + metragem), original →
-- 'trocado', marca a 1ª entrega pendente do cronograma como recebida, recalcula.
CREATE OR REPLACE FUNCTION public.receber_reposicao_troca(
  _original_item_id uuid, _data date, _metragem numeric
) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_oc uuid; v_rep uuid; v_arr jsonb; v_new jsonb := '[]'::jsonb; v_done boolean := false; v_e jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF _metragem IS NULL OR _metragem <= 0 THEN RAISE EXCEPTION 'Informe a metragem recebida'; END IF;

  SELECT it.oc_tecido_id INTO v_oc FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
   WHERE it.id = _original_item_id AND oc.tenant_id = v_tenant;
  IF v_oc IS NULL THEN RAISE EXCEPTION 'Item não encontrado'; END IF;

  SELECT id INTO v_rep FROM public.ocs_tecido_itens
   WHERE substitui_item_id = _original_item_id AND oc_tecido_id = v_oc
   ORDER BY created_at DESC LIMIT 1;
  IF v_rep IS NULL THEN RAISE EXCEPTION 'Reposição não encontrada'; END IF;

  UPDATE public.ocs_tecido_itens SET quantidade_recebida = _metragem WHERE id = v_rep;
  UPDATE public.ocs_tecido_itens SET cq_alerta_status = 'trocado' WHERE id = _original_item_id;

  -- marca a 1ª entrada pendente do cronograma de recebimento como recebida (com a data)
  SELECT parcelas_recebimento INTO v_arr FROM public.ocs_tecido WHERE id = v_oc;
  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(v_arr, '[]'::jsonb)) LOOP
    IF NOT v_done AND COALESCE((v_e->>'recebido')::boolean, false) = false THEN
      v_new := v_new || jsonb_build_array(jsonb_build_object('data', _data::text, 'recebido', true));
      v_done := true;
    ELSE
      v_new := v_new || jsonb_build_array(v_e);
    END IF;
  END LOOP;
  IF NOT v_done THEN
    v_new := v_new || jsonb_build_array(jsonb_build_object('data', _data::text, 'recebido', true));
  END IF;
  UPDATE public.ocs_tecido SET parcelas_recebimento = v_new WHERE id = v_oc;

  UPDATE public.ocs_tecido oc SET
    valor_real_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_recebida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0),
    valor_previsto_total = COALESCE((SELECT SUM(COALESCE(it.quantidade_pedida,0)*COALESCE(a.preco,0))
      FROM public.ocs_tecido_itens it LEFT JOIN public.artigos a ON a.id=it.artigo_id
      WHERE it.oc_tecido_id=oc.id AND COALESCE(it.cancelado,false)=false),0)
  WHERE oc.id = v_oc;
  PERFORM public.recalcular_parcelas(v_oc, 'tecido');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.aplicar_resolucao_alerta_tecido(uuid, text, uuid, uuid, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.receber_reposicao_troca(uuid, date, numeric) FROM anon;
