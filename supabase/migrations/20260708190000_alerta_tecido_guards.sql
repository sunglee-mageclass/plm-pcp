-- Alerta de Tecido — fixes cirúrgicos do diagnóstico (C1+C2+A1).
-- C2: guarda de máquina de estados em _aplicar_resolucao_alerta_tecido_core (só transição válida).
-- C1: idempotência em _receber_reposicao_troca_core (só troca pendente + substituto não recebido).
-- A1: estoque_tecido_por_artigo — baixa ignora item cancelado (baixa órfã de item cancelado
--     inflava/deflacionava o físico; simétrico ao recebido, que já filtrava).

CREATE OR REPLACE FUNCTION public.estoque_tecido_por_artigo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH recebido AS (
    SELECT it.artigo_id,
      SUM(CASE WHEN a.unidade_medida = 'kg'
               THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento, 0)
               ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0)
          END) AS m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status = 'recebido'
      AND COALESCE(it.cancelado, false) = false
      AND it.artigo_id IS NOT NULL
    GROUP BY it.artigo_id
  ),
  baixa AS (
    -- Fonte ÚNICA = ledger estoque_tecido_baixas (corte com déficit, separacao_rolo,
    -- ajuste). Antes somava metragem_enviada do CAD, que ignora ajuste/rolo (cad_id
    -- NULL) e o déficit do corte (LEAST), divergindo do estoque real.
    SELECT it.artigo_id, SUM(COALESCE(b.quantidade, 0)) AS m
    FROM public.estoque_tecido_baixas b
    JOIN public.ocs_tecido_itens it ON it.id = b.oc_tecido_item_id
    WHERE b.tenant_id = v_tenant
      AND it.artigo_id IS NOT NULL
      AND COALESCE(it.cancelado, false) = false
    GROUP BY it.artigo_id
  ),
  reservado AS (
    SELECT mt.artigo_id,
      SUM(COALESCE(mt.consumo, 0) * (1 + COALESCE(mt.loss_percent, 0) / 100.0) * COALESCE(mg.grade_total, 0) * COALESCE(mtv.multiplicador, 1)) AS m
    FROM public.modelo_tecidos mt
    JOIN public.modelos m ON m.id = mt.modelo_id
    JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
    LEFT JOIN public.modelo_grades mg
      ON mg.modelo_id = mt.modelo_id AND mg.variante_numero = mtv.ordem
    WHERE m.tenant_id = v_tenant
      AND mt.artigo_id IS NOT NULL
      -- 1ª reserva: já no Desenvolvimento (BOM preenchido), sem exigir aprovação.
      AND LOWER(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
      -- mantém reservado até o corte ser confirmado (Imprimir e Enviar) -> vira baixa.
      AND NOT EXISTS (
        SELECT 1 FROM public.cad c
        WHERE c.modelo_id = m.id AND COALESCE(c.enviado_corte, false) = true
      )
    GROUP BY mt.artigo_id
  ),
  artigos_all AS (
    SELECT artigo_id FROM recebido
    UNION
    SELECT artigo_id FROM baixa
    UNION
    SELECT artigo_id FROM reservado
  ),
  calc AS (
    SELECT
      aa.artigo_id,
      (COALESCE(r.m, 0) - COALESCE(b.m, 0))::numeric AS fisico_m,
      COALESCE(rs.m, 0)::numeric AS reservado_m,
      (COALESCE(r.m, 0) - COALESCE(b.m, 0) - COALESCE(rs.m, 0))::numeric AS disponivel_m
    FROM artigos_all aa
    LEFT JOIN recebido r ON r.artigo_id = aa.artigo_id
    LEFT JOIN baixa b ON b.artigo_id = aa.artigo_id
    LEFT JOIN reservado rs ON rs.artigo_id = aa.artigo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'artigo_id', artigo_id,
    'fisico_m', fisico_m,
    'reservado_m', reservado_m,
    'disponivel_m', disponivel_m
  )), '[]'::jsonb)
  INTO v_result
  FROM calc
  WHERE fisico_m <> 0 OR reservado_m <> 0 OR disponivel_m <> 0;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public._aplicar_resolucao_alerta_tecido_core(_item_id uuid, _acao text, _rep_artigo_id uuid DEFAULT NULL::uuid, _rep_variante_id uuid DEFAULT NULL::uuid, _rep_metragem numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_oc uuid;
  v_arr jsonb; v_new jsonb; v_removed boolean; v_e jsonb; v_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT it.oc_tecido_id, it.cq_alerta_status INTO v_oc, v_status FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
   WHERE it.id = _item_id AND oc.tenant_id = v_tenant;
  IF v_oc IS NULL THEN RAISE EXCEPTION 'Item não encontrado'; END IF;

  -- Guarda de máquina de estados (C2): só transições válidas — evita corromper estoque/valor
  -- por duplo-clique / cache velho / retry / chamada direta. estilo_ok/cancelar/troca só de
  -- 'alertado'; reabrir só de um estado resolvido.
  IF _acao IN ('cancelar','estilo_ok','troca') AND v_status IS DISTINCT FROM 'alertado' THEN
    RAISE EXCEPTION 'Este item não está em alerta (estado: %) — recarregue a lista.', COALESCE(v_status,'—');
  END IF;
  IF _acao = 'reabrir' AND COALESCE(v_status,'') NOT IN ('estilo_ok','cancelado','troca_pendente') THEN
    RAISE EXCEPTION 'Este item não pode ser reaberto (estado: %).', COALESCE(v_status,'—');
  END IF;

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

CREATE OR REPLACE FUNCTION public._receber_reposicao_troca_core(_original_item_id uuid, _data date, _metragem numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_oc uuid; v_rep uuid; v_arr jsonb; v_new jsonb := '[]'::jsonb; v_done boolean := false; v_e jsonb; v_status text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF _metragem IS NULL OR _metragem <= 0 THEN RAISE EXCEPTION 'Informe a metragem recebida'; END IF;

  SELECT it.oc_tecido_id, it.cq_alerta_status INTO v_oc, v_status FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
   WHERE it.id = _original_item_id AND oc.tenant_id = v_tenant;
  IF v_oc IS NULL THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  -- idempotência (C1): só recebe reposição de troca PENDENTE (não re-recebe uma já 'trocado').
  IF v_status IS DISTINCT FROM 'troca_pendente' THEN
    RAISE EXCEPTION 'Esta troca não está pendente de recebimento (estado: %).', COALESCE(v_status,'—');
  END IF;

  SELECT id INTO v_rep FROM public.ocs_tecido_itens
   WHERE substitui_item_id = _original_item_id AND oc_tecido_id = v_oc AND quantidade_recebida IS NULL
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

REVOKE EXECUTE ON FUNCTION public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._receber_reposicao_troca_core(uuid,date,numeric) FROM PUBLIC, anon, authenticated;
