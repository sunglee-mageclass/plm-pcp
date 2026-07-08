-- #1: dashboard de estoque de TECIDO passa a usar a fonte canônica _estoque_tecido_core
-- (corrige rolo 2× / separacao_rolo como consumo / OS ignorada — mesma cura do aviamento M2).

CREATE OR REPLACE FUNCTION public._dashboard_estoque_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_total_var int; v_total_avi int;
  v_estoque_tec jsonb; v_estoque_avi jsonb; v_bar_tec jsonb; v_bar_avi jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH tec AS (
    -- fonte ÚNICA (mesma da tela): _estoque_tecido_core já exclui item destrinchado em rolo,
    -- inclui OS, clampa >=0 e trata substituto/zerado — corrige a divergência do dashboard
    -- (antes contava rolo 2×, tratava separacao_rolo como consumo e ignorava a OS).
    SELECT ea.variante_tecido_id AS id,
           (COALESCE(art.nome,'—') || ' · ' || COALESCE(v.nome_variante, v.codigo_variante, co.nome, '—')) AS nome,
           COALESCE(cat.nome,'Sem categoria') AS categoria,
           ea.fisico AS estoque,
           'Tecido' AS tipo
    FROM public._estoque_tecido_core(v_tenant) ea
    JOIN variantes_tecido v ON v.id = ea.variante_tecido_id
    JOIN artigos art ON art.id = v.artigo_id
    LEFT JOIN cores co ON co.id = v.cor_id
    LEFT JOIN categorias_tecido cat ON cat.id = art.categoria_tecido_id
  ),
  avi AS (
    -- M2: fonte ÚNICA (mesma definição da tela de Estoque, via _estoque_aviamento_core).
    -- físico já vem clampado >=0 e inclui OS baixadas / exclui cancelado+encomendado,
    -- corrigindo a divergência que fazia o dashboard mostrar número diferente da tela.
    SELECT ea.id, ea.nome, COALESCE(ea.categoria,'Sem categoria') AS categoria,
           ea.fisico AS estoque, 'Aviamento' AS tipo
    FROM public._estoque_aviamento_core(v_tenant) ea
  )
  SELECT
    (SELECT count(*) FROM variantes_tecido v JOIN artigos a ON a.id=v.artigo_id AND a.tenant_id=v_tenant),
    (SELECT count(*) FROM aviamentos WHERE tenant_id = v_tenant),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'categoria',categoria,'estoque',estoque) ORDER BY estoque DESC)
              FROM (SELECT id,nome,categoria,estoque FROM tec ORDER BY estoque DESC LIMIT 50) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome,'categoria',categoria,'estoque',estoque) ORDER BY estoque DESC)
              FROM (SELECT id,nome,categoria,estoque FROM avi ORDER BY estoque DESC LIMIT 50) t), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'total',total))
              FROM (SELECT categoria, SUM(GREATEST(0,estoque)) AS total FROM tec GROUP BY categoria) c), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria',categoria,'total',total))
              FROM (SELECT categoria, SUM(GREATEST(0,estoque)) AS total FROM avi GROUP BY categoria) c), '[]'::jsonb)
  INTO v_total_var, v_total_avi, v_estoque_tec, v_estoque_avi, v_bar_tec, v_bar_avi;

  RETURN jsonb_build_object(
    'totalVariantes', v_total_var,
    'totalAviamentos', v_total_avi,
    'estoqueTecido', v_estoque_tec,
    'estoqueAviamento', v_estoque_avi,
    'barTecido', v_bar_tec,
    'barAviamento', v_bar_avi
  );
END;
$function$;
