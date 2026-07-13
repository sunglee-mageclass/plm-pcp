-- Leadtime: adiciona a etapa MACRO "Planejamento" (o dono pediu — é o 1º passo do fluxo,
-- antes do Desenvolvimento). Marco: início = modelos.created_at (card criado no Planejamento);
-- fim = modelos.ordem_criacao_enviada_at (quando a ordem de criação é enviada, o modelo sai
-- do Planejamento e entra no Desenvolvimento). Só conta os que já foram enviados.
-- Redefine o _core mantendo o filtro/ordem por config (Fase 2).

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
  v_has_cfg boolean;
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT leadtime INTO v_cfg FROM public.tenant_config WHERE tenant_id = v_tenant;
  v_has_cfg := (v_cfg ? 'etapas') AND jsonb_array_length(COALESCE(v_cfg->'etapas', '[]'::jsonb)) > 0;

  WITH
  -- Durações MACRO por modelo (em dias), uma etapa por UNION.
  macro AS (
    -- Planejamento: card criado -> ordem de criação enviada (sai p/ Desenvolvimento).
    SELECT 'planejamento'::text AS etapa, 'macro'::text AS tipo, 'Planejamento'::text AS label,
           (m.ordem_criacao_enviada_at::date - m.created_at::date)::numeric AS dias
      FROM public.modelos m
      WHERE m.tenant_id = v_tenant AND m.ordem_criacao_enviada_at IS NOT NULL
    UNION ALL
    SELECT 'cad_corte', 'macro', 'CAD → Corte',
           (c.data_enviado_corte - c.created_at::date)::numeric
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
  -- Etapas escolhidas na Config da Loja (ideal + ordem de exibição).
  sel AS (
    SELECT e->>'key' AS key, (e->>'idealDias')::numeric AS ideal, ord
      FROM jsonb_array_elements(COALESCE(v_cfg->'etapas', '[]'::jsonb)) WITH ORDINALITY AS t(e, ord)
  ),
  stats AS (
    SELECT s.etapa, s.tipo, s.label,
      COALESCE(MIN(sel.ideal), CASE WHEN s.tipo = 'kanban' THEN 5 ELSE 7 END) AS ideal,
      MIN(sel.ord) AS ord,
      COUNT(*) AS n,
      ROUND(AVG(GREATEST(s.dias, 0)), 1) AS media
    FROM spans s
    LEFT JOIN sel ON sel.key = s.etapa
    WHERE (NOT v_has_cfg OR sel.key IS NOT NULL)  -- com config: só as escolhidas
    GROUP BY s.etapa, s.tipo, s.label
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'etapa', etapa, 'tipo', tipo, 'label', label,
      'idealDias', ideal, 'nModelos', n, 'duracaoMedia', media,
      'foraSla', fora, 'pctNoPrazo', pct
    ) ORDER BY ord NULLS LAST, tipo DESC, media DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT st.*,
      (SELECT COUNT(*) FROM spans s2 WHERE s2.etapa = st.etapa AND GREATEST(s2.dias,0) > st.ideal) AS fora,
      (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE GREATEST(s2.dias,0) <= st.ideal) / NULLIF(COUNT(*),0), 0)
         FROM spans s2 WHERE s2.etapa = st.etapa) AS pct
    FROM stats st
  ) z;

  -- Devolve também a ordem das colunas do kanban (status_kanban cru) p/ o front ordenar as
  -- etapas de Desenvolvimento pela ORDEM DO FLUXO (normalizeKanbanStatuses), não por duração.
  RETURN jsonb_build_object(
    'etapas', v_out,
    'kanbanOrder', (SELECT status_kanban FROM public.tenant_config WHERE tenant_id = v_tenant)
  );
END;
$function$;

COMMIT;
