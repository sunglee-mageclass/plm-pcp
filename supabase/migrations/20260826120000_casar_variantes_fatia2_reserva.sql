-- Casar variantes — Fatia 2 (Task 1): reserva pelo par casado
--
-- Um bloco de tecido complementar (Tecido 2/3, Forro, Entretela) que está CASADO com
-- variantes do Tecido 1 (via modelo_tecido_variantes.complementa_variante_ids uuid[])
-- passa a RESERVAR pela Σ das grades das cores do Tecido 1 casadas, em vez da grade da
-- própria posição. SEM arredondamento (mantém fracionado). Bloco complementar SEM
-- casamento = comportamento de hoje intacto. Tecido 1 = comportamento de hoje intacto.
--
-- A fórmula de reserva é DUPLICADA em _estoque_tecido_core (SSOT, CTE reserva_mod) e no
-- espelho detalhe_estoque_variante (invariante #4) — a mesma troca entra nas DUAS. Um
-- helper SECURITY DEFINER centraliza a soma da grade do par p/ evitar drift.
--
-- NÃO toca o abate/baixa (_baixar_estoque_tecido_corte_core usa metragem_enviada — fora de escopo).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — helper de soma de grade do par
-- Soma grade_total das variantes do Tecido 1 (tipo='tecido', numero=1) do PRÓPRIO
-- modelo cujo variante_tecido_id ∈ _complementa_ids. Amarra ao modelo (mt1.modelo_id
-- = _modelo_id) → sem cross-model; id órfão (variante do Tecido 1 removida) não casa →
-- não soma, sem erro.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._grade_soma_pares(_modelo_id uuid, _complementa_ids uuid[])
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(mg.grade_total), 0)
  FROM public.modelo_tecido_variantes mv1
  JOIN public.modelo_tecidos mt1 ON mt1.id = mv1.modelo_tecido_id
     AND mt1.modelo_id = _modelo_id AND mt1.tipo = 'tecido' AND mt1.numero = 1
  JOIN public.modelo_grades mg ON mg.modelo_id = _modelo_id AND mg.variante_numero = mv1.ordem
  WHERE mv1.variante_tecido_id = ANY(_complementa_ids);
$function$;

REVOKE EXECUTE ON FUNCTION public._grade_soma_pares(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — _estoque_tecido_core (SSOT). Único delta: o fator COALESCE(g.gt,0) do
-- reserva_mod vira um CASE (Tecido 1 → g.gt; complementar CASADO → Σ grades do par;
-- ELSE → g.gt = comportamento de hoje). Nada mais muda.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._estoque_tecido_core(_tenant uuid)
 RETURNS TABLE(variante_tecido_id uuid, artigo_id uuid, prev_receb_m numeric, recebido_m numeric, baixa numeric, reservado numeric, fisico numeric, previsto numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  origem_rolos AS (
    SELECT DISTINCT o.rolo_origem_item_id AS item_id
    FROM ocs_tecido o
    WHERE o.tenant_id = _tenant AND o.is_rolo AND o.rolo_origem_item_id IS NOT NULL
  ),
  itens AS (
    SELECT it.id, it.variante_tecido_id, it.artigo_id, it.quantidade_pedida, it.quantidade_recebida,
           it.substitui_item_id, oc.status,
           a.unidade_medida, COALESCE(a.rendimento, 0) AS rendimento
    FROM ocs_tecido_itens it
    JOIN ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = _tenant
    LEFT JOIN artigos a ON a.id = it.artigo_id
    WHERE it.variante_tecido_id IS NOT NULL
      AND COALESCE(it.cancelado, false) = false
      AND NOT EXISTS (SELECT 1 FROM origem_rolos r WHERE r.item_id = it.id)
  ),
  prev AS (
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg' THEN COALESCE(quantidade_pedida,0) * rendimento
                    ELSE COALESCE(quantidade_pedida,0) END) AS m
    FROM itens WHERE status = 'encomendado'
    GROUP BY variante_tecido_id
  ),
  receb AS (
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg'
                    THEN COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) * rendimento
                    ELSE COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) END) AS m
    FROM itens WHERE status = 'recebido'
    GROUP BY variante_tecido_id
  ),
  baixa_led AS (
    SELECT i.variante_tecido_id, SUM(COALESCE(b.quantidade, 0)) AS m
    FROM itens i
    JOIN estoque_tecido_baixas b ON b.oc_tecido_item_id = i.id
    WHERE i.status = 'recebido'
    GROUP BY i.variante_tecido_id
  ),
  os_baixa AS (
    SELECT oi.variante_tecido_id, SUM(COALESCE(oi.baixa, 0)) AS m
    FROM ordens_saida_tecido_itens oi
    JOIN ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
    WHERE oi.variante_tecido_id IS NOT NULL
    GROUP BY oi.variante_tecido_id
  ),
  os_reserva AS (
    SELECT oi.variante_tecido_id, SUM(COALESCE(oi.reserva, 0)) AS m
    FROM ordens_saida_tecido_itens oi
    JOIN ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND NOT os.baixado
    WHERE oi.variante_tecido_id IS NOT NULL
    GROUP BY oi.variante_tecido_id
  ),
  grade AS (
    SELECT modelo_id, variante_numero, SUM(COALESCE(grade_total, 0)) AS gt
    FROM modelo_grades WHERE variante_numero IS NOT NULL
    GROUP BY modelo_id, variante_numero
  ),
  reserva_mod AS (
    SELECT mv.variante_tecido_id,
           SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
               * CASE
                   WHEN mt.tipo = 'tecido' AND mt.numero = 1 THEN COALESCE(g.gt,0)
                   WHEN mv.complementa_variante_ids IS NOT NULL AND cardinality(mv.complementa_variante_ids) > 0
                     THEN public._grade_soma_pares(mt.modelo_id, mv.complementa_variante_ids)
                   ELSE COALESCE(g.gt,0)   -- complementar SEM casamento = comportamento de hoje
                 END
               * COALESCE(mv.multiplicador,1)) AS m
    FROM modelo_tecido_variantes mv
    JOIN modelo_tecidos mt ON mt.id = mv.modelo_tecido_id
    JOIN modelos m ON m.id = mt.modelo_id AND m.tenant_id = _tenant
      AND lower(COALESCE(m.status_desenvolvimento,'')) <> 'reprovado'
      AND NOT EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
    LEFT JOIN grade g ON g.modelo_id = mt.modelo_id AND g.variante_numero = mv.ordem
    WHERE mv.variante_tecido_id IS NOT NULL
    GROUP BY mv.variante_tecido_id
  ),
  agg AS (
    SELECT v.id AS variante_tecido_id, v.artigo_id,
           COALESCE(prev.m, 0) AS prev_receb_m,
           COALESCE(receb.m, 0) AS recebido_m,
           COALESCE(bl.m, 0) + COALESCE(ob.m, 0) AS baixa,
           COALESCE(rm.m, 0) + COALESCE(orr.m, 0) AS reservado
    FROM variantes_tecido v
    JOIN artigos a ON a.id = v.artigo_id AND a.tenant_id = _tenant
    LEFT JOIN prev ON prev.variante_tecido_id = v.id
    LEFT JOIN receb ON receb.variante_tecido_id = v.id
    LEFT JOIN baixa_led bl ON bl.variante_tecido_id = v.id
    LEFT JOIN os_baixa ob ON ob.variante_tecido_id = v.id
    LEFT JOIN os_reserva orr ON orr.variante_tecido_id = v.id
    LEFT JOIN reserva_mod rm ON rm.variante_tecido_id = v.id
  )
  SELECT agg.variante_tecido_id, agg.artigo_id, agg.prev_receb_m, agg.recebido_m, agg.baixa, agg.reservado,
         GREATEST(0, agg.recebido_m - agg.baixa) AS fisico,
         GREATEST(0, agg.recebido_m - agg.baixa) + agg.prev_receb_m - agg.reservado AS previsto
  FROM agg
$function$;

-- _core: EXECUTE revogado dos TRÊS (invariante #9); só postgres/service_role (owner).
REVOKE EXECUTE ON FUNCTION public._estoque_tecido_core(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — detalhe_estoque_variante (espelho). Mesma troca no subselect de reserva:
-- o fator grade_total por l.ordem vira o CASE. Complementa_variante_ids vem da linha
-- mtv daquele bloco+ordem (subselect). Wrapper público (grant authenticated).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.detalhe_estoque_variante(_variante_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recebida DESC, data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.id AS oc_id,
      oc.numero_pedido,
      COALESCE(oc.is_rolo, false) AS is_rolo,
      oc.rolo_codigo,
      COALESCE(oc.data_entrega, oc.data_prevista_entrega) AS data_entrega,
      oc.created_at,
      e.nome_fantasia AS fornecedor,
      (oc.status = 'recebido') AS recebida,
      CASE WHEN oc.status = 'recebido' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_pedida,0) END AS prev_receb_m,
      CASE WHEN oc.status <> 'recebido' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END AS recebido_m,
      COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0) AS baixado_m,
      COALESCE((
        SELECT SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
                   * ( CASE
                         WHEN mt.tipo = 'tecido' AND mt.numero = 1 THEN COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
                         WHEN (SELECT mtv.complementa_variante_ids FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem) IS NOT NULL
                              AND cardinality((SELECT mtv.complementa_variante_ids FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem)) > 0
                           THEN public._grade_soma_pares(l.modelo_id, (SELECT mtv.complementa_variante_ids FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem))
                         ELSE COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
                       END )
                   * COALESCE((SELECT mtv.multiplicador FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem),1))
        FROM public.modelo_tecido_oc_links l
        JOIN public.modelo_tecidos mt
          ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
        WHERE l.oc_tecido_item_id = it.id
          AND NOT EXISTS (
            SELECT 1 FROM public.cad c
            JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
            WHERE c.modelo_id = l.modelo_id
          )
      ),0) AS reservado_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.empresas e ON e.id = oc.empresa_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status IN ('recebido', 'encomendado')
      AND COALESCE(it.cancelado, false) = false
      AND it.variante_tecido_id = _variante_id
      AND NOT EXISTS (
        SELECT 1 FROM public.ocs_tecido r WHERE r.is_rolo = true AND r.rolo_origem_item_id = it.id
      )
  ) t;
  RETURN v_result;
END;
$function$;

-- wrapper público: revoga PUBLIC/anon; mantém EXECUTE p/ authenticated (front-facing).
REVOKE EXECUTE ON FUNCTION public.detalhe_estoque_variante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detalhe_estoque_variante(uuid) TO authenticated;

COMMIT;
