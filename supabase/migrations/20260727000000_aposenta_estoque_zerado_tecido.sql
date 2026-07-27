BEGIN;

-- Aposenta o conceito `estoque_zerado` de tecido, PRESERVANDO o físico.
-- Um lote zerado hoje é EXCLUÍDO do físico (recebido E baixa somem). Para remover a flag
-- sem mudar o físico, cada lote recebido zerado precisa ficar NET 0 = baixa == recebido_m.
--   • Se recebido_m > baixa: adiciona uma baixa de AJUSTE = (recebido_m - baixa)  → write-off.
--   • Se recebido_m <= baixa: já é net <= 0 (ex.: Malha Tessa kg, recebido_m == baixa) → nada.
-- Depois des-zera todos os itens e remove a lógica de estoque_zerado das 4 funções que a usam.
-- Genérico (todos os tenants) + idempotente. Rodar dentro de BEGIN;…COMMIT;.

SET LOCAL session_replication_role = replica;  -- migração admin: sem gatilhos (set_tenant/audit)

INSERT INTO public.estoque_tecido_baixas (tenant_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem, motivo)
SELECT x.tenant_id, x.variante_tecido_id, x.item_id, x.delta, 'ajuste',
       'Encerramento do lote (aposentadoria do estoque_zerado): baixa = recebido p/ físico 0.'
FROM (
  SELECT it.id AS item_id, it.variante_tecido_id, oc.tenant_id,
    (CASE WHEN a.unidade_medida='kg'
          THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento,0)
          ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END)
    - COALESCE((SELECT SUM(b.quantidade) FROM public.estoque_tecido_baixas b WHERE b.oc_tecido_item_id = it.id), 0) AS delta
  FROM public.ocs_tecido_itens it
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
  LEFT JOIN public.artigos a ON a.id = it.artigo_id
  WHERE COALESCE(it.estoque_zerado, false) = true
    AND oc.status = 'recebido'
    AND COALESCE(it.cancelado, false) = false
) x
WHERE x.delta > 0.0001
  AND NOT EXISTS (  -- idempotência: não repetir o write-off se já foi feito
    SELECT 1 FROM public.estoque_tecido_baixas b
    WHERE b.oc_tecido_item_id = x.item_id AND b.origem = 'ajuste'
      AND b.motivo LIKE 'Encerramento do lote (aposentadoria do estoque_zerado)%'
  );

UPDATE public.ocs_tecido_itens SET estoque_zerado = false WHERE COALESCE(estoque_zerado, false) = true;

SET LOCAL session_replication_role = DEFAULT;

-- ── _estoque_tecido_core: some `AND NOT estoque_zerado` (×2) + o alias ──────────────────
CREATE OR REPLACE FUNCTION public._estoque_tecido_core(_tenant uuid)
 RETURNS TABLE(variante_tecido_id uuid, artigo_id uuid, prev_receb_m numeric, recebido_m numeric, baixa numeric, reservado numeric, fisico numeric, previsto numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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

-- ── detalhe_estoque_variante: some a chave estoque_zerado e os CASE dela ─────────────────
CREATE OR REPLACE FUNCTION public.detalhe_estoque_variante(_variante_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
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
                   * COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
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

-- ── ocs_disponiveis_variante: some o `CASE WHEN estoque_zerado THEN 0 ELSE (...) END` ────
CREATE OR REPLACE FUNCTION public.ocs_disponiveis_variante(_variante_id uuid, _modelo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recebida DESC, data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.numero_pedido,
      COALESCE(oc.is_rolo, false) AS is_rolo,
      oc.rolo_codigo,
      oc.rolo_origem_item_id,
      oc_org.id AS oc_origem_id,
      oc_org.numero_pedido AS oc_origem_numero,
      oc.data_entrega,
      oc.created_at,
      (oc.status = 'recebido') AS recebida,
      (
        (CASE
           WHEN oc.status = 'recebido' THEN
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_recebida,0) END
           ELSE
             CASE WHEN a.unidade_medida='kg'
                  THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
                  ELSE COALESCE(it.quantidade_pedida,0) END
         END)
        - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
        - COALESCE((
            SELECT SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
                       * COALESCE((SELECT mg.grade_total FROM public.modelo_grades mg WHERE mg.modelo_id = l.modelo_id AND mg.variante_numero = l.ordem),0)
                       * COALESCE((SELECT mtv.multiplicador FROM public.modelo_tecido_variantes mtv WHERE mtv.modelo_tecido_id = mt.id AND mtv.ordem = l.ordem),1))
            FROM public.modelo_tecido_oc_links l
            JOIN public.modelo_tecidos mt ON mt.modelo_id = l.modelo_id AND mt.tipo = l.tipo AND mt.numero = l.numero
            WHERE l.oc_tecido_item_id = it.id
              AND (_modelo_id IS NULL OR l.modelo_id <> _modelo_id)
              AND NOT EXISTS (
                SELECT 1 FROM public.cad c
                JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
                WHERE c.modelo_id = l.modelo_id
              )
          ),0)
      ) AS disponivel_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.ocs_tecido_itens oit_org ON oit_org.id = oc.rolo_origem_item_id
    LEFT JOIN public.ocs_tecido oc_org ON oc_org.id = oit_org.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND it.variante_tecido_id = _variante_id
      AND COALESCE(it.cancelado, false) = false
  ) t;
  RETURN v_result;
END;
$function$;

-- ── ocs_para_rolo: some `AND COALESCE(it.estoque_zerado, false) = false` ─────────────────
CREATE OR REPLACE FUNCTION public.ocs_para_rolo()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(oc_row ORDER BY is_rolo, label), '[]'::jsonb)
  FROM (
    SELECT COALESCE(oc.is_rolo, false) AS is_rolo,
      (CASE WHEN oc.is_rolo THEN COALESCE(oc.rolo_codigo, oc.numero_pedido) ELSE oc.numero_pedido END) AS label,
      jsonb_build_object(
        'oc_id', oc.id,
        'numero_pedido', oc.numero_pedido,
        'is_rolo', COALESCE(oc.is_rolo, false),
        'label', (CASE WHEN oc.is_rolo THEN COALESCE(oc.rolo_codigo, oc.numero_pedido) ELSE oc.numero_pedido END),
        'itens', itens.arr
      ) AS oc_row
    FROM public.ocs_tecido oc
    JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'oc_tecido_item_id', it.id,
               'artigo_id', it.artigo_id,
               'artigo_nome', a.nome,
               'variante_tecido_id', it.variante_tecido_id,
               'variante', COALESCE(
                             NULLIF(concat_ws(' - ', NULLIF(btrim(cb.nome), ''), NULLIF(btrim(ca.nome), '')), ''),
                             vt.nome_variante, vt.codigo_variante, '—'),
               'disponivel_m', disp.m
             ) ORDER BY a.nome, cb.nome, ca.nome, vt.nome_variante) AS arr
      FROM public.ocs_tecido_itens it
      LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
      LEFT JOIN public.cores cb ON cb.id = vt.cor_id
      LEFT JOIN public.cores_apelido ca ON ca.id = vt.cor_apelido_id
      LEFT JOIN public.artigos a ON a.id = it.artigo_id
      CROSS JOIN LATERAL (
        SELECT (CASE WHEN a.unidade_medida = 'kg'
                     THEN COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.rendimento,0)
                     ELSE COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) END)
               - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0) AS m
      ) disp
      WHERE it.oc_tecido_id = oc.id
        AND it.variante_tecido_id IS NOT NULL
        AND COALESCE(it.cancelado, false) = false
        AND disp.m > 0.0001
    ) itens ON itens.arr IS NOT NULL
    WHERE oc.tenant_id = public.get_user_tenant_id()
      AND oc.status = 'recebido'
  ) t;
$function$;

COMMIT;
