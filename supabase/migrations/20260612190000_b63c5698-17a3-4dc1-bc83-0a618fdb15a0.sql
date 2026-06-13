-- Considerar reservas de outros modelos no saldo de OC oferecido no vínculo manual
-- (Desenvolvimento > Tecidos > OcLinkSelect), evitando que dois modelos reservem
-- mais do que o lote realmente tem até a baixa real no corte.

DROP FUNCTION IF EXISTS public.ocs_disponiveis_variante(uuid);

CREATE OR REPLACE FUNCTION public.ocs_disponiveis_variante(_variante_id uuid, _modelo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.numero_pedido,
      oc.data_entrega,
      (CASE WHEN a.unidade_medida='kg'
           THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_recebida,0) END
      - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
      -- reservado por OUTROS modelos: vínculo ainda não baixado no corte
      - COALESCE((
          SELECT SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
                     * COALESCE((SELECT SUM(grade_total) FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id),0))
          FROM public.modelo_tecido_oc_links l
          JOIN public.modelo_tecidos mt
            ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
          WHERE l.oc_tecido_item_id = it.id
            AND (_modelo_id IS NULL OR l.modelo_id <> _modelo_id)
            AND NOT EXISTS (
              SELECT 1 FROM public.cad c
              JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
              WHERE c.modelo_id = l.modelo_id
            )
        ),0)
      ) AS saldo_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status = 'recebido'
      AND it.variante_tecido_id = _variante_id
  ) t
  WHERE (t.saldo_m)::numeric > 0;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.ocs_disponiveis_variante(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ocs_disponiveis_variante(uuid, uuid) TO authenticated;
