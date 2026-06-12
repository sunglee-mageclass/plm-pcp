
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS estoque_critico_threshold NUMERIC NOT NULL DEFAULT 0;

-- Update dashboard_estoque to honor per-tenant threshold and return it
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
    SELECT it.variante_tecido_id,
           SUM(CASE WHEN a.unidade_medida='kg' THEN COALESCE(it.quantidade_recebida,0) * COALESCE(a.rendimento,0)
                    ELSE COALESCE(it.quantidade_recebida,0) END) AS total
    FROM ocs_tecido_itens it
    JOIN ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = v_tenant
    LEFT JOIN artigos a ON a.id = it.artigo_id
    WHERE it.variante_tecido_id IS NOT NULL
    GROUP BY it.variante_tecido_id
  ),
  baixa AS (
    SELECT cv.variante_tecido_id, SUM(COALESCE(cv.metragem_enviada,0)) AS total
    FROM cad_tecido_variantes cv
    JOIN cad_tecidos ct ON ct.id = cv.cad_tecido_id
    JOIN cad c ON c.id = ct.cad_id AND c.tenant_id = v_tenant AND c.enviado_corte
    WHERE cv.variante_tecido_id IS NOT NULL
    GROUP BY cv.variante_tecido_id
  ),
  tec AS (
    SELECT v.id,
           (COALESCE(art.nome,'—') || ' · ' || COALESCE(v.nome_variante, v.codigo_variante, co.nome, '—')) AS nome,
           COALESCE(cat.nome,'Sem categoria') AS categoria,
           (COALESCE(rec.total,0) - COALESCE(baixa.total,0)) AS estoque,
           'Tecido' AS tipo
    FROM variantes_tecido v
    JOIN artigos art ON art.id = v.artigo_id AND art.tenant_id = v_tenant
    LEFT JOIN cores co ON co.id = v.cor_id
    LEFT JOIN categorias_tecido cat ON cat.id = art.categoria_tecido_id
    LEFT JOIN rec   ON rec.variante_tecido_id = v.id
    LEFT JOIN baixa ON baixa.variante_tecido_id = v.id
  ),
  avi_rec AS (
    SELECT i.aviamento_id, SUM(COALESCE(i.quantidade_recebida,0)) AS total
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant
    WHERE i.aviamento_id IS NOT NULL
    GROUP BY i.aviamento_id
  ),
  avi_baixa AS (
    SELECT ca.aviamento_id, SUM(COALESCE(ca.quantidade_enviar,0)) AS total
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
$function$;

-- Update dashboard_producao to include taxa de defeito por terceirizado
CREATE OR REPLACE FUNCTION public.dashboard_producao()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_timeline jsonb;
  v_sla jsonb;
  v_no_prazo int := 0;
  v_atrasos int := 0;
  v_total int := 0;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH c AS (
    SELECT cd.id, cd.modelo_id, m.ref, m.nome,
      EXISTS(SELECT 1 FROM lancamentos l WHERE l.modelo_id = cd.modelo_id) AS lanc,
      EXISTS(SELECT 1 FROM direcionamento d WHERE d.cad_id = cd.id) AS dirc,
      EXISTS(SELECT 1 FROM producao_acabamento a WHERE a.cad_id = cd.id AND a.ativo) AS acab,
      EXISTS(SELECT 1 FROM controle_qualidade q WHERE q.cad_id = cd.id) AS cq,
      EXISTS(SELECT 1 FROM producao_oficina o WHERE o.cad_id = cd.id AND o.data_enviado IS NOT NULL) AS ofic,
      EXISTS(SELECT 1 FROM producao_terceirizados t WHERE t.cad_id = cd.id AND t.ativo) AS terc
    FROM cad cd
    JOIN modelos m ON m.id = cd.modelo_id
    WHERE cd.tenant_id = v_tenant
    ORDER BY m.ref
    LIMIT 200
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'ref', ref, 'nome', nome,
    'etapa', CASE
      WHEN lanc THEN 'Lançado'
      WHEN dirc THEN 'Direcionamento'
      WHEN acab THEN 'Acabamento'
      WHEN cq THEN 'Controle de Qualidade'
      WHEN ofic THEN 'Oficina'
      WHEN terc THEN 'Terceirizado'
      ELSE 'CAD' END
  )), '[]'::jsonb) INTO v_timeline FROM c;

  WITH entregas AS (
    SELECT t.terceirizado_id, t.data_enviado, t.data_prevista, t.data_entregue,
           t.cad_id, COALESCE(t.quantidade_recebida,0) AS qrec, COALESCE(t.quantidade_defeito,0) AS qdef
    FROM producao_terceirizados t
    JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
    WHERE t.terceirizado_id IS NOT NULL
    UNION ALL
    SELECT a.terceirizado_id, a.data_enviado, a.data_prevista, a.data_entregue,
           a.cad_id, 0::int AS qrec, 0::int AS qdef
    FROM producao_acabamento a
    JOIN cad c ON c.id = a.cad_id AND c.tenant_id = v_tenant
    WHERE a.terceirizado_id IS NOT NULL
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'nome', nome, 'slaMedio', slaMedio, 'atrasos', atrasos, 'total', total,
      'pecasProduzidas', pecasProduzidas, 'pecasDefeito', pecasDefeito,
      'taxaDefeito', CASE WHEN pecasProduzidas > 0 THEN ROUND((pecasDefeito::numeric / pecasProduzidas) * 100, 2) ELSE 0 END
    )), '[]'::jsonb)
  INTO v_sla
  FROM (
    SELECT t.nome,
      AVG(EXTRACT(EPOCH FROM (e.data_entregue::timestamp - e.data_enviado::timestamp))/86400)
        FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS slaMedio,
      COUNT(*) FILTER (WHERE e.data_entregue IS NOT NULL AND e.data_prevista IS NOT NULL AND e.data_entregue > e.data_prevista) AS atrasos,
      COUNT(*) FILTER (WHERE e.data_enviado IS NOT NULL AND e.data_entregue IS NOT NULL) AS total,
      SUM(e.qrec) AS pecasProduzidas,
      SUM(e.qdef) AS pecasDefeito
    FROM entregas e
    JOIN terceirizados t ON t.id = e.terceirizado_id
    GROUP BY t.nome
  ) s;

  WITH entregas2 AS (
    SELECT t.data_prevista, t.data_entregue
    FROM producao_terceirizados t JOIN cad c ON c.id=t.cad_id AND c.tenant_id=v_tenant
    WHERE t.data_entregue IS NOT NULL AND t.data_prevista IS NOT NULL
    UNION ALL
    SELECT a.data_prevista, a.data_entregue
    FROM producao_acabamento a JOIN cad c ON c.id=a.cad_id AND c.tenant_id=v_tenant
    WHERE a.data_entregue IS NOT NULL AND a.data_prevista IS NOT NULL
  )
  SELECT
    count(*) FILTER (WHERE data_entregue <= data_prevista),
    count(*) FILTER (WHERE data_entregue > data_prevista),
    count(*)
  INTO v_no_prazo, v_atrasos, v_total
  FROM entregas2;

  RETURN jsonb_build_object(
    'timeline', v_timeline,
    'slaPorTerc', v_sla,
    'kpiPrazo', jsonb_build_object(
      'noPrazo', v_no_prazo,
      'atrasadas', v_atrasos,
      'pct', CASE WHEN v_total > 0 THEN ROUND((v_no_prazo::numeric/v_total)*100) ELSE 0 END
    )
  );
END;
$function$;
