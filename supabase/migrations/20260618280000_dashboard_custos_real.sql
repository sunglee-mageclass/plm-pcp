-- Custos: "custo real" = custo de CAD (materiais por peça: tecidos + aviamentos)
-- + serviços (custo_terceirizados_previsto), mas SÓ quando o modelo está
-- confirmado em CAD (cad.enviado_corte). Antes disso, real = previsto
-- (custo_peca_previsto), para a diferença não ficar esquisita.
-- Aviamento por peça = consumo * preço (antes usava quantidade_enviar = total).
CREATE OR REPLACE FUNCTION public.dashboard_custos(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_categoria uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rows jsonb; v_chart jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH cad_conf AS (
    SELECT DISTINCT ON (c.modelo_id) c.modelo_id, c.id AS cad_id
    FROM cad c
    WHERE c.tenant_id = v_tenant AND c.enviado_corte
    ORDER BY c.modelo_id, c.data_enviado_corte DESC NULLS LAST
  ),
  mat AS (  -- materiais por peça do CAD confirmado
    SELECT cc.modelo_id,
      COALESCE((SELECT SUM(CASE WHEN ct.custo_cad IS NOT NULL THEN ct.custo_cad
          ELSE COALESCE(ct.consumo_cad,0) * (1 + COALESCE(ct.loss_percent_cad,0)/100.0) * COALESCE(a.preco_por_metro,0) END)
        FROM cad_tecidos ct LEFT JOIN artigos a ON a.id = ct.artigo_id WHERE ct.cad_id = cc.cad_id), 0)
      + COALESCE((SELECT SUM(COALESCE(ca.consumo,0) * COALESCE(av.preco,0))
        FROM cad_aviamentos ca LEFT JOIN aviamentos av ON av.id = ca.aviamento_id WHERE ca.cad_id = cc.cad_id), 0) AS materials
    FROM cad_conf cc
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, m.colecao, m.versao,
      EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id) AS confirmado,
      COALESCE(m.custo_peca_previsto, 0) AS previsto,
      CASE WHEN EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id)
        THEN COALESCE((SELECT materials FROM mat WHERE mat.modelo_id = m.id), 0) + COALESCE(m.custo_terceirizados_previsto, 0)
        ELSE COALESCE(m.custo_peca_previsto, 0)
      END AS real
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'ref', ref, 'nome', nome, 'colecao', colecao, 'versao', versao, 'confirmado', confirmado,
        'previsto', previsto, 'real', real, 'diff', (real - previsto),
        'pct', CASE WHEN previsto > 0 THEN ((real - previsto)/previsto)*100 ELSE 0 END
      ) ORDER BY ref) FROM base), '[]'::jsonb),
    -- Custo médio por peça por coleção: só modelos confirmados em CAD.
    COALESCE((SELECT jsonb_agg(jsonb_build_object('colecao', colecao, 'medio', medio))
              FROM (SELECT colecao, AVG(NULLIF(real,0)) AS medio FROM base WHERE colecao IS NOT NULL AND confirmado GROUP BY colecao) c), '[]'::jsonb)
  INTO v_rows, v_chart;

  RETURN jsonb_build_object(
    'rows', v_rows, 'chartData', v_chart,
    'filtros', jsonb_build_object(
      'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM categorias_produto WHERE tenant_id=v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id=v_tenant AND colecao IS NOT NULL), '[]'::jsonb)
    )
  );
END;
$function$;
