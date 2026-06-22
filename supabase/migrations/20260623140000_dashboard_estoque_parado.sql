-- Dashboard Financeiro: "Estoque em R$ parado" = valor (R$) do tecido FÍSICO que
-- não está reservado nem foi usado (livre) × preço por metro do artigo.
-- Reaproveita a mesma lógica de recebido/baixa/reservado de estoque_tecido_por_artigo
-- (livre = recebido − baixa − reservado), só que valorizando em R$.

CREATE OR REPLACE FUNCTION public.dashboard_estoque_parado()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('total', 0, 'porArtigo', '[]'::jsonb);
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
      AND LOWER(COALESCE(m.status_desenvolvimento, '')) <> 'reprovado'
      AND NOT EXISTS (
        SELECT 1 FROM public.cad c
        WHERE c.modelo_id = m.id AND COALESCE(c.enviado_corte, false) = true
      )
    GROUP BY mt.artigo_id
  ),
  artigos_all AS (
    SELECT artigo_id FROM recebido
    UNION SELECT artigo_id FROM baixa
    UNION SELECT artigo_id FROM reservado
  ),
  val AS (
    SELECT a.nome,
      GREATEST(COALESCE(r.m, 0) - COALESCE(b.m, 0) - COALESCE(rs.m, 0), 0)::numeric
        * COALESCE(a.preco_por_metro, 0)::numeric AS valor
    FROM artigos_all aa
    JOIN public.artigos a ON a.id = aa.artigo_id
    LEFT JOIN recebido r ON r.artigo_id = aa.artigo_id
    LEFT JOIN baixa b ON b.artigo_id = aa.artigo_id
    LEFT JOIN reservado rs ON rs.artigo_id = aa.artigo_id
  ),
  pos AS (SELECT nome, ROUND(valor, 2) AS valor FROM val WHERE valor > 0)
  SELECT jsonb_build_object(
    'total', COALESCE((SELECT SUM(valor) FROM pos), 0),
    'porArtigo', COALESCE((SELECT jsonb_agg(jsonb_build_object('nome', nome, 'valor', valor) ORDER BY valor DESC)
                           FROM (SELECT nome, valor FROM pos ORDER BY valor DESC LIMIT 8) t), '[]'::jsonb)
  ) INTO v_out;

  RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.dashboard_estoque_parado() FROM anon;
GRANT EXECUTE ON FUNCTION public.dashboard_estoque_parado() TO authenticated;
