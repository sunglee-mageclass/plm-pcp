-- Leadtime — tracking INDIVIDUAL: RPC dashboard_leadtime_itens(). Devolve, por MODELO,
-- a duração (dias) em cada etapa (mesmas keys da agregada: macro / servico_cat:<id> /
-- kanban:<status>) num jsonb `duracoes`, + metadata p/ agrupar (coleção, subcoleção,
-- semana, subcategoria1). O front monta a matriz item × etapas e colore vs o ideal.
-- Filtros opcionais por coleção/subcoleção/semana. Padrão wrapper+_core (#9).

BEGIN;

CREATE OR REPLACE FUNCTION public._dashboard_leadtime_itens_core(
  p_colecao uuid DEFAULT NULL, p_subcolecao text DEFAULT NULL, p_semana text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH
  spans AS (
    -- MACRO (uma linha por modelo por etapa)
    SELECT m.id AS modelo_id, 'planejamento'::text AS etapa,
           (m.ordem_criacao_enviada_at::date - m.created_at::date)::numeric AS dias
      FROM public.modelos m
      WHERE m.tenant_id = v_tenant AND m.ordem_criacao_enviada_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cad_corte', (c.data_enviado_corte - c.created_at::date)::numeric
      FROM public.cad c
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'servicos', (svc.dt - c.data_enviado_corte)::numeric
      FROM public.cad c
      JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL AND svc.dt IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cq', (q.confirmado_at::date - COALESCE(svc.dt, q.created_at::date))::numeric
      FROM public.controle_qualidade q
      JOIN public.cad c ON c.id = q.cad_id AND c.tenant_id = v_tenant
      LEFT JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'direcionamento', (c.direcionamento_confirmado_at::date - q.confirmado_at::date)::numeric
      FROM public.cad c
      JOIN public.controle_qualidade q ON q.cad_id = c.id
      WHERE c.tenant_id = v_tenant AND c.direcionamento_confirmado_at IS NOT NULL AND q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT m.id, 'lancamento', (m.data_lancamento - c.direcionamento_confirmado_at::date)::numeric
      FROM public.modelos m
      JOIN public.cad c ON c.modelo_id = m.id
      WHERE m.tenant_id = v_tenant AND m.data_lancamento IS NOT NULL AND c.direcionamento_confirmado_at IS NOT NULL
    UNION ALL
    -- SERVIÇOS MICRO por categoria (data_enviado → data_entregue)
    SELECT c.modelo_id, 'servico_cat:' || ct.id::text, (pt.data_entregue - pt.data_enviado)::numeric
      FROM public.producao_terceirizados pt
      JOIN public.cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
      JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
      WHERE pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL
    UNION ALL
    -- KANBAN por coluna (tempo em cada status)
    SELECT h.modelo_id, 'kanban:' || h.status,
           (EXTRACT(EPOCH FROM (
              COALESCE(lead(h.entrou_at) OVER (PARTITION BY h.modelo_id ORDER BY h.entrou_at), now()) - h.entrou_at
            )) / 86400.0)::numeric
      FROM public.modelo_kanban_historico h
      WHERE h.tenant_id = v_tenant
  ),
  -- soma por (modelo, etapa): junta múltiplos blocos de serviço / revisitas de coluna.
  per_etapa AS (
    SELECT modelo_id, etapa, ROUND(SUM(GREATEST(dias, 0)), 1) AS dias
      FROM spans GROUP BY modelo_id, etapa
  ),
  dur AS (
    SELECT modelo_id, jsonb_object_agg(etapa, dias) AS duracoes
      FROM per_etapa GROUP BY modelo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'modelo_id', m.id, 'ref', m.ref, 'nome', m.nome, 'versao', m.versao,
      'colecao', COALESCE(col.nome, m.colecao), 'colecao_id', m.colecao_id,
      'subcolecao', m.subcolecao, 'semana', m.semana,
      'sub1_id', m.subcategoria1_id, 'sub1', s1.nome,
      'duracoes', d.duracoes
    ) ORDER BY COALESCE(col.nome, m.colecao) NULLS LAST, m.subcolecao NULLS LAST, m.semana NULLS LAST, m.ref NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM public.modelos m
  JOIN dur d ON d.modelo_id = m.id          -- só modelos com alguma etapa medível
  LEFT JOIN public.colecoes col ON col.id = m.colecao_id
  LEFT JOIN public.subcategorias1_produto s1 ON s1.id = m.subcategoria1_id
  WHERE m.tenant_id = v_tenant
    AND (p_colecao IS NULL OR m.colecao_id = p_colecao)
    AND (p_subcolecao IS NULL OR m.subcolecao = p_subcolecao)
    AND (p_semana IS NULL OR m.semana = p_semana);

  RETURN jsonb_build_object('itens', v_out);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_leadtime_itens(
  p_colecao uuid DEFAULT NULL, p_subcolecao text DEFAULT NULL, p_semana text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_leadtime') THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN public._dashboard_leadtime_itens_core(p_colecao, p_subcolecao, p_semana);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._dashboard_leadtime_itens_core(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_leadtime_itens(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_leadtime_itens(uuid, text, text) TO authenticated;

COMMIT;
