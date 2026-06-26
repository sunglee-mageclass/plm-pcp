-- Ranking de oficinas: SLA ENTREGUE (real, dias enviado→entregue) vs SLA CADASTRADO
-- (categorias_produto.sla_oficina, via cad→modelo→categoria_principal). Oficina = bloco
-- de producao_terceirizados cuja categoria de serviço é 'Oficina'. Filtro opcional por
-- categoria de produto (p_categoria_produto); sem filtro = ranking geral. Só entram
-- entregas cujo produto tem sla_oficina cadastrado (senão não há benchmark).
-- Ordena do MELHOR (menor desvio real−esperado) para o pior.

CREATE OR REPLACE FUNCTION public._ranking_oficinas_core(p_categoria_produto uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_ranking jsonb; v_categorias jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH entregas AS (
    SELECT ter.nome_responsavel AS oficina,
           EXTRACT(EPOCH FROM (t.data_entregue::timestamp - t.data_enviado::timestamp))/86400 AS real_dias,
           cp.sla_oficina AS esperado
    FROM producao_terceirizados t
    JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id AND ct.nome ILIKE 'oficina'
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    JOIN terceirizados ter ON ter.id = t.terceirizado_id
    JOIN categorias_produto cp ON cp.id = m.categoria_principal_id AND cp.sla_oficina IS NOT NULL
    WHERE t.terceirizado_id IS NOT NULL
      AND t.data_enviado IS NOT NULL AND t.data_entregue IS NOT NULL
      AND (p_categoria_produto IS NULL OR m.categoria_principal_id = p_categoria_produto)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'oficina', oficina,
      'entregas', n,
      'slaReal', ROUND(sla_real, 2),
      'slaEsperado', ROUND(sla_esperado, 2),
      'desvio', ROUND(sla_real - sla_esperado, 2),
      'pctDentro', pct_dentro
    ) ORDER BY (sla_real - sla_esperado) ASC, n DESC), '[]'::jsonb)
  INTO v_ranking
  FROM (
    SELECT oficina,
      COUNT(*) AS n,
      AVG(real_dias) AS sla_real,
      AVG(esperado)::numeric AS sla_esperado,
      ROUND(100.0 * COUNT(*) FILTER (WHERE real_dias <= esperado) / COUNT(*), 0) AS pct_dentro
    FROM entregas
    GROUP BY oficina
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY nome), '[]'::jsonb)
  INTO v_categorias
  FROM categorias_produto
  WHERE tenant_id = v_tenant AND sla_oficina IS NOT NULL;

  RETURN jsonb_build_object('ranking', v_ranking, 'categorias', v_categorias);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._ranking_oficinas_core(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ranking_oficinas(p_categoria_produto uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_producao' USING ERRCODE='42501';
  END IF;
  RETURN public._ranking_oficinas_core(p_categoria_produto);
END $function$;
