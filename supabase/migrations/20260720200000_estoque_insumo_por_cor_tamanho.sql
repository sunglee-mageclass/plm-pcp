-- Estoque de Insumo por (insumo · tamanho · cor) — correção da revisão do time (achado HIGH).
-- Antes: a baixa fazia INNER JOIN em variantes_etiqueta por (tamanho,cor); quando a cor do CAD
-- não casava uma variante (ex.: "Sem cor" em insumo colorido), a baixa SUMIA e o físico ficava
-- alto demais + linhas-fantasma negativas. Agora: recebido e baixa são chaveados pela CHAVE
-- NATURAL (etiqueta, tamanho, cor) e netam direto; físico clampa a ≥0 (igual tecido/aviamento).
-- Casa com a decisão "por cor + tamanho": o CAD passa a gravar enviar_por_tamanho só para
-- (tamanho,cor) que existem como variante, então recebido e baixa caem sempre na mesma chave.

CREATE OR REPLACE FUNCTION public._estoque_etiqueta_core(_tenant uuid)
 RETURNS TABLE(etiqueta_id uuid, etiqueta_nome text, variante_id uuid, tamanho text, cor_nome text,
               recebido numeric, prev_receb numeric, baixa numeric, fisico numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH
  rec AS (  -- recebido: chave (etiqueta, tamanho, cor) da variante da OC recebida
    SELECT i.etiqueta_id AS etq, ve.tamanho AS tam, ve.cor_id AS cor,
           SUM(COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0)) AS tot
    FROM ocs_etiqueta_itens i
    JOIN ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant AND o.status = 'recebido'
    LEFT JOIN variantes_etiqueta ve ON ve.id = i.variante_etiqueta_id
    WHERE COALESCE(i.cancelado, false) = false
    GROUP BY 1, 2, 3
  ),
  prev AS (  -- previsto: OC encomendada
    SELECT i.etiqueta_id AS etq, ve.tamanho AS tam, ve.cor_id AS cor,
           SUM(COALESCE(i.quantidade_pedida, 0)) AS tot
    FROM ocs_etiqueta_itens i
    JOIN ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant AND o.status = 'encomendado'
    LEFT JOIN variantes_etiqueta ve ON ve.id = i.variante_etiqueta_id
    WHERE COALESCE(i.cancelado, false) = false
    GROUP BY 1, 2, 3
  ),
  baixa_var AS (  -- consumo por tamanho: chave (etiqueta, tamanho=key, cor do CAD)
    SELECT ce.etiqueta_id AS etq, kv.key AS tam, ce.cor_id AS cor, SUM((kv.value)::numeric) AS tot
    FROM cad_etiquetas ce
    JOIN cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
    JOIN LATERAL jsonb_each_text(COALESCE(ce.enviar_por_tamanho, '{}'::jsonb)) kv ON true
    GROUP BY 1, 2, 3
  ),
  baixa_sem AS (  -- consumo sem tamanho: chave (etiqueta, NULL, cor do CAD)
    SELECT ce.etiqueta_id AS etq, NULL::text AS tam, ce.cor_id AS cor, SUM(COALESCE(ce.quantidade_enviar, 0)) AS tot
    FROM cad_etiquetas ce
    JOIN cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
    WHERE COALESCE(ce.enviar_por_tamanho, '{}'::jsonb) = '{}'::jsonb
    GROUP BY 1, 3
  ),
  baixa AS (
    SELECT etq, tam, cor, SUM(tot) AS tot
    FROM (SELECT * FROM baixa_var UNION ALL SELECT * FROM baixa_sem) x
    GROUP BY 1, 2, 3
  ),
  keys AS (
    SELECT etq, tam, cor FROM rec
    UNION SELECT etq, tam, cor FROM prev
    UNION SELECT etq, tam, cor FROM baixa
  )
  SELECT k.etq, e.nome::text,
         ve.id,                                   -- variante_id (referência; NULL se a baixa não casa variante)
         k.tam, cor.nome::text,
         COALESCE(rec.tot, 0), COALESCE(prev.tot, 0), COALESCE(baixa.tot, 0),
         GREATEST(0, COALESCE(rec.tot, 0) - COALESCE(baixa.tot, 0))   -- físico nunca negativo (igual tecido/aviamento)
  FROM keys k
  JOIN etiquetas e ON e.id = k.etq AND e.tenant_id = _tenant
  LEFT JOIN variantes_etiqueta ve ON ve.etiqueta_id = k.etq
       AND ve.tamanho IS NOT DISTINCT FROM k.tam AND ve.cor_id IS NOT DISTINCT FROM k.cor
  LEFT JOIN cores cor ON cor.id = k.cor
  LEFT JOIN rec  ON rec.etq  = k.etq AND rec.tam  IS NOT DISTINCT FROM k.tam AND rec.cor  IS NOT DISTINCT FROM k.cor
  LEFT JOIN prev ON prev.etq = k.etq AND prev.tam IS NOT DISTINCT FROM k.tam AND prev.cor IS NOT DISTINCT FROM k.cor
  LEFT JOIN baixa ON baixa.etq = k.etq AND baixa.tam IS NOT DISTINCT FROM k.tam AND baixa.cor IS NOT DISTINCT FROM k.cor
  ORDER BY e.nome, k.tam NULLS FIRST;
$function$;

REVOKE EXECUTE ON FUNCTION public._estoque_etiqueta_core(uuid) FROM PUBLIC, anon, authenticated;

select pg_notify('pgrst','reload schema');
