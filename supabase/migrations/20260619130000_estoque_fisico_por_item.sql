-- Estoque: físico por ITEM de OC (recebido_item − baixa_item, itens zerados
-- fora). Conserta o caso de variante com item zerado + não-zerado, em que a
-- trava por variante escondia o estoque do item não-zerado.
CREATE OR REPLACE FUNCTION public.dashboard_estoque()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_threshold numeric := 0;
  v_total_var int;
  v_total_avi int;
  v_zerados int;
  v_top10 jsonb;
  v_bar jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT COALESCE(estoque_critico_threshold, 0) INTO v_threshold
  FROM tenant_config WHERE tenant_id = v_tenant;
  v_threshold := COALESCE(v_threshold, 0);

  WITH rec AS (
    -- Físico LÍQUIDO por ITEM de OC: (recebido_item − baixa_item do ledger), com
    -- itens "estoque zerado" fora (recebido E baixa). Evita que a baixa de um item
    -- zerado derrube o estoque de itens não-zerados da mesma variante.
    SELECT it.variante_tecido_id,
           SUM(CASE WHEN it.estoque_zerado THEN 0
                    ELSE (CASE WHEN a.unidade_medida='kg' THEN COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.rendimento,0)
                               ELSE COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) END)
                         - COALESCE((SELECT SUM(b.quantidade) FROM estoque_tecido_baixas b WHERE b.oc_tecido_item_id = it.id),0)
               END) AS estoque
    FROM ocs_tecido_itens it
    JOIN ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = v_tenant AND oc.status = 'recebido'
    LEFT JOIN artigos a ON a.id = it.artigo_id
    WHERE it.variante_tecido_id IS NOT NULL AND COALESCE(it.cancelado,false) = false
    GROUP BY it.variante_tecido_id
  ),
  tec AS (
    SELECT v.id,
           (COALESCE(art.nome,'—') || ' · ' || COALESCE(v.nome_variante, v.codigo_variante, co.nome, '—')) AS nome,
           COALESCE(cat.nome,'Sem categoria') AS categoria,
           COALESCE(rec.estoque,0) AS estoque,
           'Tecido' AS tipo
    FROM variantes_tecido v
    JOIN artigos art ON art.id = v.artigo_id AND art.tenant_id = v_tenant
    LEFT JOIN cores co ON co.id = v.cor_id
    LEFT JOIN categorias_tecido cat ON cat.id = art.categoria_tecido_id
    LEFT JOIN rec   ON rec.variante_tecido_id = v.id
  ),
  avi_rec AS (
    SELECT i.aviamento_id, SUM(COALESCE(i.quantidade_recebida,0)) AS total
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant
    WHERE i.aviamento_id IS NOT NULL
    GROUP BY i.aviamento_id
  ),
  avi_baixa AS (
    -- baixa de aviamento = quantidade_separar (se houver) senão quantidade_enviar (= regra da tela)
    SELECT ca.aviamento_id, SUM(COALESCE(NULLIF(ca.quantidade_separar,0), ca.quantidade_enviar, 0)) AS total
    FROM cad_aviamentos ca
    JOIN cad c ON c.id = ca.cad_id AND c.tenant_id = v_tenant AND c.enviado_corte
    WHERE ca.aviamento_id IS NOT NULL
    GROUP BY ca.aviamento_id
  ),
  avi AS (
    SELECT a.id, a.codigo_nome AS nome, 'Aviamento'::text AS categoria,
           (COALESCE(r.total,0) - COALESCE(b.total,0)) AS estoque,
           'Aviamento' AS tipo
    FROM aviamentos a
    LEFT JOIN avi_rec r ON r.aviamento_id = a.id
    LEFT JOIN avi_baixa b ON b.aviamento_id = a.id
    WHERE a.tenant_id = v_tenant
  ),
  all_items AS (SELECT * FROM tec UNION ALL SELECT * FROM avi)
  SELECT
    (SELECT count(*) FROM variantes_tecido v JOIN artigos a ON a.id=v.artigo_id AND a.tenant_id=v_tenant),
    (SELECT count(*) FROM aviamentos WHERE tenant_id = v_tenant),
    (SELECT count(*) FROM all_items WHERE estoque <= v_threshold),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'tipo',tipo,'estoque',estoque) ORDER BY estoque ASC)
              FROM (SELECT id,nome,tipo,estoque FROM all_items ORDER BY estoque ASC LIMIT 10) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'total',total))
              FROM (SELECT categoria, SUM(GREATEST(0,estoque)) AS total FROM tec GROUP BY categoria) c), '[]'::jsonb)
  INTO v_total_var, v_total_avi, v_zerados, v_top10, v_bar;

  RETURN jsonb_build_object(
    'totalVariantes', v_total_var,
    'totalAviamentos', v_total_avi,
    'zerados', v_zerados,
    'threshold', v_threshold,
    'top10', v_top10,
    'barData', v_bar
  );
END;
$function$

;
