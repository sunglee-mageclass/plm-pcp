-- ALTO (diagnóstico OC Tecido): "Desfazer troca" (_aplicar_resolucao_alerta_tecido_core ação
-- 'reabrir') NÃO desfazia a troca: só des-cancelava o item original, deixando (a) o item
-- SUBSTITUTO órfão (ativo, recebida NULL) → valor_previsto DOBRADO (2 itens ativos) e pendência
-- de recebimento ETERNA no Financeiro, e (b) a entrada vazia que a troca acrescentou no
-- cronograma parcelas_recebimento. Agora 'reabrir':
--   • se a reposição JÁ foi recebida (substituto com recebida NOT NULL) → BLOQUEIA (reabrir
--     duplicaria previsto + órfão de estoque; estornar recebimento é outro fluxo);
--   • se a troca está PENDENTE (substituto recebida NULL) → remove o substituto + UMA entrada
--     vazia do cronograma (desfaz a troca de verdade);
--   • sem substituto (cancelado/estilo_ok/devolucao) → só des-cancela (comportamento de sempre).

CREATE OR REPLACE FUNCTION public._aplicar_resolucao_alerta_tecido_core(_item_id uuid, _acao text, _rep_artigo_id uuid DEFAULT NULL::uuid, _rep_variante_id uuid DEFAULT NULL::uuid, _rep_metragem numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_oc uuid;
  v_arr jsonb; v_new jsonb; v_removed boolean; v_e jsonb;
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
    -- Reabrir uma troca já RECEBIDA duplicaria o previsto e orfanaria a reposição (que tem
    -- estoque); estornar o recebimento é outro fluxo. Bloqueia com mensagem clara.
    IF EXISTS (SELECT 1 FROM public.ocs_tecido_itens
               WHERE substitui_item_id = _item_id AND oc_tecido_id = v_oc
                 AND quantidade_recebida IS NOT NULL) THEN
      RAISE EXCEPTION 'A reposição desta troca já foi recebida — não é possível reabrir.';
    END IF;
    -- "Desfazer troca" (troca pendente): remove o substituto órfão + UMA entrada vazia que a
    -- troca acrescentou no cronograma de recebimento.
    IF EXISTS (SELECT 1 FROM public.ocs_tecido_itens
               WHERE substitui_item_id = _item_id AND oc_tecido_id = v_oc
                 AND quantidade_recebida IS NULL) THEN
      DELETE FROM public.ocs_tecido_itens
       WHERE substitui_item_id = _item_id AND oc_tecido_id = v_oc AND quantidade_recebida IS NULL;
      SELECT parcelas_recebimento INTO v_arr FROM public.ocs_tecido WHERE id = v_oc;
      v_new := '[]'::jsonb; v_removed := false;
      FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(v_arr, '[]'::jsonb)) LOOP
        IF NOT v_removed AND COALESCE(v_e->>'data','') = '' AND COALESCE((v_e->>'recebido')::boolean, false) = false THEN
          v_removed := true;  -- descarta UMA entrada vazia (a que a troca acrescentou)
        ELSE
          v_new := v_new || jsonb_build_array(v_e);
        END IF;
      END LOOP;
      UPDATE public.ocs_tecido SET parcelas_recebimento = v_new WHERE id = v_oc;
    END IF;
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

select pg_notify('pgrst','reload schema');
