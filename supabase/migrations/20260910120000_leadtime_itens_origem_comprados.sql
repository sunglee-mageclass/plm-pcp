-- Leadtime por origem (set/2026): a aba "Leadtime" (visão por gestor) ganha sub-abas Interno /
-- Acabado / Importado — cada origem com seu fluxo e médias, sem contaminar. Para isso a RPC
-- _dashboard_leadtime_itens_core passa a (1) devolver `origem` por item e (2) medir o span de
-- COMPRA dos comprados: OC (data_pedido) → recebimento (data_entrega) — revenda via ocs_p_acabado,
-- importado via ocs_importado (produto_*→modelo_id). Os demais spans (cad_corte/servicos/cq/
-- direcionamento/lancamento/kanban) já existiam e continuam byte-a-byte. CREATE OR REPLACE
-- reproduzindo o corpo + 2 spans + a chave 'origem'. Diff-validar; reafirmar REVOKE (invariante #9).
-- NOTA: ocs_importado_etapas é financeiro (parcelas de câmbio), não etapa de TEMPO — por isso o
-- trânsito/câmbio entra embutido no span OC→recebimento (honesto com o dado). Zero span inventado.

BEGIN;

CREATE OR REPLACE FUNCTION public._dashboard_leadtime_itens_core(p_colecao uuid DEFAULT NULL::uuid, p_subcolecao text DEFAULT NULL::text, p_semana text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
  v_sla_servico text;  -- etapa cujo prazo vem do SLA da Sub1 (servicos | servico_cat:<id>)
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT leadtime->>'slaServico' INTO v_sla_servico FROM public.tenant_config WHERE tenant_id = v_tenant;

  WITH
  spans AS (
    SELECT m.id AS modelo_id, 'planejamento'::text AS etapa,
           (m.ordem_criacao_enviada_at::date - m.created_at::date)::numeric AS dias
      FROM public.modelos m
      WHERE m.tenant_id = v_tenant AND m.ordem_criacao_enviada_at IS NOT NULL
    UNION ALL
    -- COMPRA (revenda): OC feita → recebimento. Liga ocs_p_acabado → produtos_acabados → modelo.
    SELECT pa.modelo_id, 'compra', (oc.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_p_acabado oc
      JOIN public.produtos_acabados pa ON pa.id = oc.produto_acabado_id AND pa.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND oc.data_entrega IS NOT NULL AND pa.modelo_id IS NOT NULL
    UNION ALL
    -- COMPRA (importado): OC feita → recebimento (inclui trânsito/câmbio; etapas de câmbio são
    -- financeiras, sem marco de tempo próprio). Liga ocs_importado → produtos_importados → modelo.
    SELECT pi.modelo_id, 'compra', (oc.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_importado oc
      JOIN public.produtos_importados pi ON pi.id = oc.produto_importado_id AND pi.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND oc.data_entrega IS NOT NULL AND pi.modelo_id IS NOT NULL
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
    SELECT c.modelo_id, 'servico_cat:' || ct.id::text, (pt.data_entregue - pt.data_enviado)::numeric
      FROM public.producao_terceirizados pt
      JOIN public.cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
      JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
      WHERE pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL
    UNION ALL
    SELECT h.modelo_id, 'kanban:' || h.status,
           (EXTRACT(EPOCH FROM (
              COALESCE(lead(h.entrou_at) OVER (PARTITION BY h.modelo_id ORDER BY h.entrou_at), now()) - h.entrou_at
            )) / 86400.0)::numeric
      FROM public.modelo_kanban_historico h
      WHERE h.tenant_id = v_tenant
  ),
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
      'origem', COALESCE(m.origem, 'interno'),
      'colecao', COALESCE(col.nome, m.colecao), 'colecao_id', m.colecao_id,
      'subcolecao', m.subcolecao, 'semana', m.semana,
      'sub1_id', m.subcategoria1_id, 'sub1', s1.nome, 'sub1_sla', s1.sla_oficina,
      'duracoes', d.duracoes
    ) ORDER BY COALESCE(col.nome, m.colecao) NULLS LAST, m.subcolecao NULLS LAST, m.semana NULLS LAST, m.ref NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM public.modelos m
  JOIN dur d ON d.modelo_id = m.id
  LEFT JOIN public.colecoes col ON col.id = m.colecao_id
  LEFT JOIN public.subcategorias1_produto s1 ON s1.id = m.subcategoria1_id
  WHERE m.tenant_id = v_tenant
    AND (p_colecao IS NULL OR m.colecao_id = p_colecao)
    AND (p_subcolecao IS NULL OR m.subcolecao = p_subcolecao)
    AND (p_semana IS NULL OR m.semana = p_semana);

  RETURN jsonb_build_object('itens', v_out, 'slaServico', v_sla_servico);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._dashboard_leadtime_itens_core(uuid, text, text) FROM public, anon, authenticated;

COMMIT;

select pg_notify('pgrst','reload schema');
