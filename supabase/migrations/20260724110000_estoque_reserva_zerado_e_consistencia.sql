-- Estoque: reserva no lote zerado + consistência das leituras secundárias.
--
-- Auditoria (time de 4 agentes, jul/2026) apontou dois defeitos comprovados em dados
-- reais de produção:
--
-- (Q2) COLAPSO DO `zeradas` (falso-negativo de reserva → previsto superestimado):
--   `_estoque_tecido_core` zerava a reserva da VARIANTE INTEIRA quando QUALQUER item
--   de OC recebido dela estava `estoque_zerado`, mesmo com outros lotes com estoque e
--   demanda real. Decisão do dono: zerar um lote deve liberar SÓ a metragem daquele
--   lote (o físico já é por-item: receb/baixa_led já excluem o item zerado), mantendo
--   a reserva (reserva_mod + os_reserva) — que é demanda de modelo, não pertence a
--   lote. Efeito: previsto pode ficar negativo quando a reserva excede o físico, o que
--   é DESEJADO ("zerar estoque dentro de Consumo por OC" limpa o estoque).
--   → remove a CTE `zeradas` e o CASE de colapso; reservado = reserva_mod + os_reserva.
--
-- (Q3) DRIFT DE CONSISTÊNCIA (falso-positivo de físico → estoque/valor superestimado):
--   `estoque_tecido_por_artigo` e `_dashboard_estoque_parado_core` re-implementavam a
--   conta de estoque e NÃO filtravam `estoque_zerado` (nem excluíam origem de rolo, nem
--   clampavam por variante), divergindo do canônico que a tela usa (+147 m fantasmas em
--   um tenant real; "R$ parado" inflado). → reapontadas para rolar `_estoque_tecido_core`
--   por artigo (mesmo padrão que `dashboard_estoque` já usa), eliminando o drift e o
--   clamp assimétrico de uma vez.
--
-- ACLs preservadas por CREATE OR REPLACE (os _core seguem revogados de PUBLIC/anon/
-- authenticated — invariante #9).

-- ── (Q2) canônico: reserva não colapsa mais no lote zerado ───────────────────────────
CREATE OR REPLACE FUNCTION public._estoque_tecido_core(_tenant uuid)
 RETURNS TABLE(variante_tecido_id uuid, artigo_id uuid, prev_receb_m numeric, recebido_m numeric, baixa numeric, reservado numeric, fisico numeric, previsto numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH
  origem_rolos AS (  -- itens destrinchados em rolos (a origem sai; só os rolos contam)
    SELECT DISTINCT o.rolo_origem_item_id AS item_id
    FROM ocs_tecido o
    WHERE o.tenant_id = _tenant AND o.is_rolo AND o.rolo_origem_item_id IS NOT NULL
  ),
  itens AS (  -- itens de OC válidos (não cancelado, não origem-destrinchada), com kg/rendimento
    SELECT it.id, it.variante_tecido_id, it.artigo_id, it.quantidade_pedida, it.quantidade_recebida,
           COALESCE(it.estoque_zerado, false) AS estoque_zerado, it.substitui_item_id, oc.status,
           a.unidade_medida, COALESCE(a.rendimento, 0) AS rendimento
    FROM ocs_tecido_itens it
    JOIN ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = _tenant
    LEFT JOIN artigos a ON a.id = it.artigo_id
    WHERE it.variante_tecido_id IS NOT NULL
      AND COALESCE(it.cancelado, false) = false
      AND NOT EXISTS (SELECT 1 FROM origem_rolos r WHERE r.item_id = it.id)
  ),
  prev AS (  -- previsto a receber (metros): OC encomendada
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg' THEN COALESCE(quantidade_pedida,0) * rendimento
                    ELSE COALESCE(quantidade_pedida,0) END) AS m
    FROM itens WHERE status = 'encomendado'
    GROUP BY variante_tecido_id
  ),
  receb AS (  -- recebido (metros): OC recebida, item NÃO zerado (zerar remove o lote do físico)
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg'
                    THEN COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) * rendimento
                    ELSE COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) END) AS m
    FROM itens WHERE status = 'recebido' AND NOT estoque_zerado
    GROUP BY variante_tecido_id
  ),
  baixa_led AS (  -- baixa do ledger, por item recebido não-zerado (mesmo predicado do receb)
    SELECT i.variante_tecido_id, SUM(COALESCE(b.quantidade, 0)) AS m
    FROM itens i
    JOIN estoque_tecido_baixas b ON b.oc_tecido_item_id = i.id
    WHERE i.status = 'recebido' AND NOT i.estoque_zerado
    GROUP BY i.variante_tecido_id
  ),
  os_baixa AS (  -- OS tecido baixada → baixa
    SELECT oi.variante_tecido_id, SUM(COALESCE(oi.baixa, 0)) AS m
    FROM ordens_saida_tecido_itens oi
    JOIN ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
    WHERE oi.variante_tecido_id IS NOT NULL
    GROUP BY oi.variante_tecido_id
  ),
  os_reserva AS (  -- OS tecido aberta → reservado
    SELECT oi.variante_tecido_id, SUM(COALESCE(oi.reserva, 0)) AS m
    FROM ordens_saida_tecido_itens oi
    JOIN ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND NOT os.baixado
    WHERE oi.variante_tecido_id IS NOT NULL
    GROUP BY oi.variante_tecido_id
  ),
  grade AS (  -- grade total por (modelo, variante_numero)
    SELECT modelo_id, variante_numero, SUM(COALESCE(grade_total, 0)) AS gt
    FROM modelo_grades WHERE variante_numero IS NOT NULL
    GROUP BY modelo_id, variante_numero
  ),
  reserva_mod AS (  -- reserva por modelo reservável (não reprovado, sem CAD enviado ao corte)
    SELECT mv.variante_tecido_id,
           SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
               * COALESCE(g.gt,0) * COALESCE(mv.multiplicador,1)) AS m
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
           -- reserva é demanda de modelo/OS (não pertence a lote): zerar um lote NÃO
           -- colapsa a reserva da variante; só o físico do lote zerado é removido acima.
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

-- ── (Q3) por-artigo: rola o canônico (fonte única) em vez de re-implementar ──────────
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

  -- Rola físico/reservado do canônico _estoque_tecido_core por artigo. Antes re-implementava
  -- e NÃO filtrava estoque_zerado / origem de rolo → superava o físico (drift de +147 m).
  WITH e AS (
    SELECT artigo_id,
           SUM(fisico)    AS fisico_m,
           SUM(reservado) AS reservado_m
    FROM public._estoque_tecido_core(v_tenant)
    GROUP BY artigo_id
  ),
  calc AS (
    SELECT artigo_id,
           fisico_m::numeric,
           reservado_m::numeric,
           (fisico_m - reservado_m)::numeric AS disponivel_m
    FROM e
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

-- ── (Q3) "R$ parado" do dashboard: rola o canônico (fonte única) ─────────────────────
CREATE OR REPLACE FUNCTION public._dashboard_estoque_parado_core()
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

  -- "R$ parado" = valor do físico disponível (não reservado) do canônico _estoque_tecido_core.
  -- Antes re-implementava e ignorava estoque_zerado, inflando o valor.
  WITH e AS (
    SELECT artigo_id, SUM(fisico) AS fisico_m, SUM(reservado) AS reservado_m
    FROM public._estoque_tecido_core(v_tenant)
    GROUP BY artigo_id
  ),
  val AS (
    SELECT a.nome,
      GREATEST(e.fisico_m - e.reservado_m, 0)::numeric * COALESCE(a.preco_por_metro, 0)::numeric AS valor
    FROM e JOIN public.artigos a ON a.id = e.artigo_id
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
