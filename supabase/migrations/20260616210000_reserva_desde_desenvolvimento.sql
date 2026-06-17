-- 1ª reserva desde o Desenvolvimento (BOM preenchido, sem exigir aprovação),
-- persistindo até o corte ser confirmado (Imprimir e Enviar), quando vira baixa.

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
               THEN COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.rendimento, 0)
               ELSE COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0)
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
    SELECT ct.artigo_id, SUM(COALESCE(ctv.metragem_enviada, 0)) AS m
    FROM public.cad_tecido_variantes ctv
    JOIN public.cad_tecidos ct ON ct.id = ctv.cad_tecido_id
    JOIN public.cad c ON c.id = ct.cad_id
    WHERE c.tenant_id = v_tenant
      AND c.enviado_corte = true
      AND ct.artigo_id IS NOT NULL
    GROUP BY ct.artigo_id
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

NOTIFY pgrst, 'reload schema';
