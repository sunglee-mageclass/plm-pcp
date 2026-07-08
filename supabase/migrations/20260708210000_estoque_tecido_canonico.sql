-- #1: fonte ÚNICA de estoque de TECIDO (por variante), espelhando a definição da TELA (a
-- correta). Consumida pela tela de Estoque (hoje 8 queries + agregação no cliente) e pelo
-- dashboard (hoje diverge: conta rolo 2×, trata separacao_rolo como consumo, ignora OS).
-- Tudo em METROS (unidade canônica); a tela deriva kg = metros/rendimento.
--
-- Regras (idênticas à tela entrada-saida.estoque.tsx TecidosTab):
--  * item DESTRINCHADO em rolos (a origem) sai do cálculo — só os rolos contam.
--  * item cancelado sai.
--  * recebido = Σ toMetros(recebida ?? (substituto-a-receber ? 0 : pedida)) de OC recebida,
--    item NÃO zerado. toMetros: kg → qtd×rendimento; metro → qtd.
--  * baixa = Σ ledger estoque_tecido_baixas (item recebido, não zerado) + Σ OS baixadas.
--  * prev_receb = Σ toMetros(pedida) de OC encomendada.
--  * reservado = Σ consumo×(1+loss%)×grade(modelo,variante_numero)×mult de modelo reservável
--    (não reprovado, sem CAD enviado ao corte) + Σ OS abertas (reserva). Variante com item
--    zerado libera a reserva (reservado=0). (variante_numero = ordem; fallback posicional é
--    dormente — 0 linhas com ordem<=0.)
--  * fisico = max(0, recebido − baixa); previsto = fisico + prev_receb − reservado.

CREATE OR REPLACE FUNCTION public._estoque_tecido_core(_tenant uuid)
RETURNS TABLE(
  variante_tecido_id uuid,
  artigo_id uuid,
  prev_receb_m numeric,
  recebido_m numeric,
  baixa numeric,
  reservado numeric,
  fisico numeric,
  previsto numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
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
  zeradas AS (  -- variante com item recebido zerado → libera reserva
    SELECT DISTINCT variante_tecido_id FROM itens WHERE status = 'recebido' AND estoque_zerado
  ),
  prev AS (  -- previsto a receber (metros): OC encomendada
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg' THEN COALESCE(quantidade_pedida,0) * rendimento
                    ELSE COALESCE(quantidade_pedida,0) END) AS m
    FROM itens WHERE status = 'encomendado'
    GROUP BY variante_tecido_id
  ),
  receb AS (  -- recebido (metros): OC recebida, item NÃO zerado
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg'
                    THEN COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) * rendimento
                    ELSE COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) END) AS m
    FROM itens WHERE status = 'recebido' AND NOT estoque_zerado
    GROUP BY variante_tecido_id
  ),
  baixa_led AS (  -- baixa do ledger, por item recebido não-zerado
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
           CASE WHEN z.variante_tecido_id IS NOT NULL THEN 0
                ELSE COALESCE(rm.m, 0) + COALESCE(orr.m, 0) END AS reservado
    FROM variantes_tecido v
    JOIN artigos a ON a.id = v.artigo_id AND a.tenant_id = _tenant
    LEFT JOIN prev ON prev.variante_tecido_id = v.id
    LEFT JOIN receb ON receb.variante_tecido_id = v.id
    LEFT JOIN baixa_led bl ON bl.variante_tecido_id = v.id
    LEFT JOIN os_baixa ob ON ob.variante_tecido_id = v.id
    LEFT JOIN os_reserva orr ON orr.variante_tecido_id = v.id
    LEFT JOIN reserva_mod rm ON rm.variante_tecido_id = v.id
    LEFT JOIN zeradas z ON z.variante_tecido_id = v.id
  )
  SELECT agg.variante_tecido_id, agg.artigo_id, agg.prev_receb_m, agg.recebido_m, agg.baixa, agg.reservado,
         GREATEST(0, agg.recebido_m - agg.baixa) AS fisico,
         GREATEST(0, agg.recebido_m - agg.baixa) + agg.prev_receb_m - agg.reservado AS previsto
  FROM agg
$function$;

CREATE OR REPLACE FUNCTION public.estoque_tecido()
RETURNS TABLE(
  variante_tecido_id uuid, artigo_id uuid, prev_receb_m numeric, recebido_m numeric,
  baixa numeric, reservado numeric, fisico numeric, previsto numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._estoque_tecido_core(public.get_user_tenant_id());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._estoque_tecido_core(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.estoque_tecido() TO authenticated;
