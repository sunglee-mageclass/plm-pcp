-- Rótulo da variante em ocs_para_rolo (usado por "Separar de OC/Rolo" e "- Metragem"):
-- era COALESCE(nome_variante, codigo_variante, '—'); agora "cor base - cor apelido"
-- (fonte única src/lib/variante.ts corApelidoLabel), com fallback p/ nome/código.
create or replace function public.ocs_para_rolo()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
        AND COALESCE(it.estoque_zerado, false) = false
        AND disp.m > 0.0001
    ) itens ON itens.arr IS NOT NULL
    WHERE oc.tenant_id = public.get_user_tenant_id()
      AND oc.status = 'recebido'
  ) t;
$function$;
