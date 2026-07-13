-- Dashboard > Produção: "Ranking de oficinas" era hard-coded a Oficina (some se a
-- loja não usa Oficina). Generaliza p/ "Ranking de serviços" com SELETOR de categoria
-- de serviço (Corte/Oficina/PL/...). Prazo esperado = `data_prevista` do bloco (prazo
-- estipulado, existe p/ TODAS as categorias); desvio = data_entregue − data_prevista
-- (dias de atraso vs prazo). % no prazo = entregue ≤ prevista.
-- Padrão wrapper+_core (invariante #9). `ranking_oficinas` fica (compat), mas o front
-- passa a usar `ranking_servicos`.

BEGIN;

CREATE OR REPLACE FUNCTION public._ranking_servicos_core(p_categoria uuid DEFAULT NULL::uuid)
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

  -- Categorias de serviço da loja (para o seletor).
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'nome', nome) ORDER BY ordem NULLS LAST, nome), '[]'::jsonb)
  INTO v_categorias
  FROM public.categorias_terceirizado
  WHERE tenant_id = v_tenant;

  -- Ranking dos fornecedores da categoria selecionada, por desvio vs prazo estipulado.
  WITH entregas AS (
    -- Fornecedor = empresa, senão representante, senão colaborador (interno).
    SELECT COALESCE(emp.nome_fantasia, rep.nome, col.nome, '—') AS fornecedor,
           (t.data_entregue - t.data_enviado)::numeric AS real_dias,
           (t.data_prevista - t.data_enviado)::numeric AS prazo_dias,
           (t.data_entregue - t.data_prevista)::numeric AS desvio_dias
    FROM public.producao_terceirizados t
    JOIN public.cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN public.empresas emp ON emp.id = t.empresa_id
    LEFT JOIN public.representantes rep ON rep.id = t.representante_id
    LEFT JOIN public.colaboradores col ON col.id = t.colaborador_id
    WHERE t.data_enviado IS NOT NULL AND t.data_entregue IS NOT NULL
      AND (p_categoria IS NULL OR t.categoria_terceirizado_id = p_categoria)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'fornecedor', fornecedor,
      'entregas', n,
      'diasReal', ROUND(dias_real, 1),
      'diasPrazo', ROUND(dias_prazo, 1),
      'desvio', ROUND(desvio, 1),
      'pctDentro', pct_dentro
    ) ORDER BY desvio ASC, n DESC), '[]'::jsonb)
  INTO v_ranking
  FROM (
    SELECT fornecedor,
      COUNT(*) AS n,
      AVG(real_dias) AS dias_real,
      AVG(prazo_dias) FILTER (WHERE prazo_dias IS NOT NULL) AS dias_prazo,
      AVG(desvio_dias) FILTER (WHERE desvio_dias IS NOT NULL) AS desvio,
      ROUND(100.0 * COUNT(*) FILTER (WHERE desvio_dias IS NOT NULL AND desvio_dias <= 0)
            / NULLIF(COUNT(*) FILTER (WHERE desvio_dias IS NOT NULL), 0), 0) AS pct_dentro
    FROM entregas
    GROUP BY fornecedor
  ) s;

  RETURN jsonb_build_object('ranking', v_ranking, 'categorias', v_categorias);
END;
$function$;

CREATE OR REPLACE FUNCTION public.ranking_servicos(p_categoria uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN public._ranking_servicos_core(p_categoria);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._ranking_servicos_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ranking_servicos(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ranking_servicos(uuid) TO authenticated;

COMMIT;
