-- Leadtime — Fase 3 (backend): RPC dashboard_leadtime(). Calcula, por etapa, a duração
-- média real vs o tempo IDEAL (de tenant_config.leadtime, senão default), + % no prazo e
-- nº fora do SLA. Etapas MACRO saem dos marcos; DESENVOLVIMENTO destrincha por coluna do
-- kanban (modelo_kanban_historico). Padrão wrapper+_core (#9).

BEGIN;

CREATE OR REPLACE FUNCTION public._dashboard_leadtime_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cfg jsonb;
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT leadtime INTO v_cfg FROM public.tenant_config WHERE tenant_id = v_tenant;

  WITH
  -- Durações MACRO por modelo (em dias), uma etapa por UNION.
  macro AS (
    SELECT 'cad_corte'::text AS etapa, 'macro'::text AS tipo, 'CAD → Corte'::text AS label,
           (c.data_enviado_corte - c.created_at::date)::numeric AS dias
      FROM public.cad c
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL
    UNION ALL
    SELECT 'servicos', 'macro', 'Produção (Serviços)',
           (svc.dt - c.data_enviado_corte)::numeric
      FROM public.cad c
      JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL AND svc.dt IS NOT NULL
    UNION ALL
    SELECT 'cq', 'macro', 'CQ',
           (q.confirmado_at::date - COALESCE(svc.dt, q.created_at::date))::numeric
      FROM public.controle_qualidade q
      JOIN public.cad c ON c.id = q.cad_id AND c.tenant_id = v_tenant
      LEFT JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT 'direcionamento', 'macro', 'Direcionamento',
           (c.direcionamento_confirmado_at::date - q.confirmado_at::date)::numeric
      FROM public.cad c
      JOIN public.controle_qualidade q ON q.cad_id = c.id
      WHERE c.tenant_id = v_tenant AND c.direcionamento_confirmado_at IS NOT NULL AND q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT 'lancamento', 'macro', 'Lançamento',
           (m.data_lancamento - c.direcionamento_confirmado_at::date)::numeric
      FROM public.modelos m
      JOIN public.cad c ON c.modelo_id = m.id
      WHERE m.tenant_id = v_tenant AND m.data_lancamento IS NOT NULL AND c.direcionamento_confirmado_at IS NOT NULL
  ),
  -- Tempo em cada COLUNA do kanban (Desenvolvimento) via o histórico.
  kb AS (
    SELECT ('kanban:' || h.status) AS etapa, 'kanban'::text AS tipo, h.status AS label,
           (EXTRACT(EPOCH FROM (
              COALESCE(lead(h.entrou_at) OVER (PARTITION BY h.modelo_id ORDER BY h.entrou_at), now()) - h.entrou_at
            )) / 86400.0)::numeric AS dias
      FROM public.modelo_kanban_historico h
      WHERE h.tenant_id = v_tenant
  ),
  spans AS (SELECT * FROM macro UNION ALL SELECT * FROM kb),
  stats AS (
    SELECT s.etapa, s.tipo, s.label,
      -- ideal: da config (por key) senão default (macro 7d, kanban 5d).
      COALESCE(
        (SELECT (e->>'idealDias')::numeric FROM jsonb_array_elements(COALESCE(v_cfg->'etapas','[]'::jsonb)) e WHERE e->>'key' = s.etapa),
        CASE WHEN s.tipo = 'kanban' THEN 5 ELSE 7 END
      ) AS ideal,
      COUNT(*) AS n,
      ROUND(AVG(GREATEST(s.dias, 0)), 1) AS media
    FROM spans s
    GROUP BY s.etapa, s.tipo, s.label
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'etapa', etapa, 'tipo', tipo, 'label', label,
      'idealDias', ideal, 'nModelos', n, 'duracaoMedia', media,
      'foraSla', fora, 'pctNoPrazo', pct
    ) ORDER BY tipo DESC, media DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT st.*,
      (SELECT COUNT(*) FROM spans s2 WHERE s2.etapa = st.etapa AND GREATEST(s2.dias,0) > st.ideal) AS fora,
      (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE GREATEST(s2.dias,0) <= st.ideal) / NULLIF(COUNT(*),0), 0)
         FROM spans s2 WHERE s2.etapa = st.etapa) AS pct
    FROM stats st
  ) z;

  RETURN jsonb_build_object('etapas', v_out);
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_leadtime()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_leadtime') THEN
    RAISE EXCEPTION 'Sem permissão' USING ERRCODE = '42501';
  END IF;
  RETURN public._dashboard_leadtime_core();
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._dashboard_leadtime_core() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dashboard_leadtime() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_leadtime() TO authenticated;

COMMIT;
