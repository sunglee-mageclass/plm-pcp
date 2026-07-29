-- Picker de OC do Dev: só mostra OCs cujo artigo do item = artigo REAL da variante
-- (ignora itens legados mal-rotulados pelo cross-artigo). Não-destrutivo.
BEGIN;
CREATE OR REPLACE FUNCTION public.ocs_disponiveis_variante(_variante_id uuid, _modelo_id uuid DEFAULT NULL::uuid)
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
      oc.numero_pedido,
      COALESCE(oc.is_rolo, false) AS is_rolo,
      oc.rolo_codigo,
      oc.rolo_origem_item_id,
      oc_org.id AS oc_origem_id,
      oc_org.numero_pedido AS oc_origem_numero,
      oc.data_entrega,
      oc.created_at,
      (oc.status = 'recebido') AS recebida,
      (
        (CASE
           WHEN oc.status = 'recebido' THEN
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_recebida,0) END
           ELSE
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_pedida,0) END
         END)
        - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
        - COALESCE((
            SELECT SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
                       * COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
                       * COALESCE((SELECT mtv.multiplicador FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem),1))
            FROM public.modelo_tecido_oc_links l
            JOIN public.modelo_tecidos mt ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
            WHERE l.oc_tecido_item_id = it.id
              AND (_modelo_id IS NULL OR l.modelo_id <> _modelo_id)
              AND NOT EXISTS (
                SELECT 1 FROM public.cad c
                JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
                WHERE c.modelo_id = l.modelo_id
              )
          ),0)
      ) AS disponivel_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.ocs_tecido_itens oit_org ON oit_org.id = oc.rolo_origem_item_id
    LEFT JOIN public.ocs_tecido oc_org ON oc_org.id = oit_org.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND it.variante_tecido_id = _variante_id
      AND COALESCE(it.cancelado, false) = false
      -- só itens cujo artigo do ITEM casa com o artigo REAL da variante (ignora itens legados mal-rotulados
      -- pelo cross-artigo — senão uma OC de outro tecido aparecia no picker desta variante)
      AND it.artigo_id = COALESCE((SELECT v.artigo_id FROM public.variantes_tecido v WHERE v.id = _variante_id), it.artigo_id)
  ) t;
  RETURN v_result;
END;
$function$;

COMMIT;
