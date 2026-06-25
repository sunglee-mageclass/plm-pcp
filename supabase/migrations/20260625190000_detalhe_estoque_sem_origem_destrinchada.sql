-- detalhe_estoque_variante: o item de OC já DESTRINCHADO em rolos não aparece mais no
-- detalhe — só os rolos contam (a OC vira só registro do pedido). Evita a "duplicação"
-- (OC + rolos) e o estoque inflado quando a baixa de separação não bate exato.
CREATE OR REPLACE FUNCTION public.detalhe_estoque_variante(_variante_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recebida DESC, data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.id AS oc_id,
      oc.numero_pedido,
      COALESCE(oc.is_rolo, false) AS is_rolo,
      oc.rolo_codigo,
      COALESCE(oc.data_entrega, oc.data_prevista_entrega) AS data_entrega,
      oc.created_at,
      e.nome_fantasia AS fornecedor,
      (oc.status = 'recebido') AS recebida,
      COALESCE(it.estoque_zerado, false) AS estoque_zerado,
      CASE WHEN oc.status = 'recebido' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_pedida,0) END AS prev_receb_m,
      CASE WHEN it.estoque_zerado THEN 0
           WHEN oc.status <> 'recebido' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END AS recebido_m,
      COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0) AS baixado_m,
      CASE WHEN it.estoque_zerado THEN 0 ELSE COALESCE((
        SELECT SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
                   * COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
                   * COALESCE((SELECT mtv.multiplicador FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem),1))
        FROM public.modelo_tecido_oc_links l
        JOIN public.modelo_tecidos mt
          ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
        WHERE l.oc_tecido_item_id = it.id
          AND NOT EXISTS (
            SELECT 1 FROM public.cad c
            JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
            WHERE c.modelo_id = l.modelo_id
          )
      ),0) END AS reservado_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.empresas e ON e.id = oc.empresa_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status IN ('recebido', 'encomendado')
      AND COALESCE(it.cancelado, false) = false
      AND it.variante_tecido_id = _variante_id
      -- exclui o item de OC que já foi destrinchado em rolos (conta só os rolos)
      AND NOT EXISTS (
        SELECT 1 FROM public.ocs_tecido r WHERE r.is_rolo = true AND r.rolo_origem_item_id = it.id
      )
  ) t;
  RETURN v_result;
END;
$function$;
