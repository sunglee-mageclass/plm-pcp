-- "- Metragens" (lista de ajustes de estoque): a coluna 'variante' vinha de
-- nome_variante/codigo_variante (LEGADOS, quase sempre nulos) → mostrava "—".
-- Rótulo canônico da variante = COR BASE - COR APELIDO (src/lib/variante, memória
-- project_variante_cor_apelido), com fallback nos legados. Também tolera baixa sem
-- variante_tecido_id própria (cai na variante do ITEM da OC). Mudança mínima.
CREATE OR REPLACE FUNCTION public.ajustes_estoque_lista()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'created_at', b.created_at,
    'quantidade', b.quantidade,
    'motivo', b.motivo,
    'origem_label', CASE WHEN oc.is_rolo THEN 'Rolo ' || COALESCE(oc.rolo_codigo, oc.numero_pedido, '—')
                         ELSE 'OC ' || COALESCE(oc.numero_pedido, '—') END,
    'artigo', a.nome,
    'variante', COALESCE(NULLIF(concat_ws(' - ', cor.nome, ap.nome), ''), vt.nome_variante, vt.codigo_variante, '—'),
    'por', COALESCE(u.nome, u.email, '—')
  ) ORDER BY b.created_at DESC), '[]'::jsonb)
  FROM public.estoque_tecido_baixas b
  JOIN public.ocs_tecido_itens it ON it.id = b.oc_tecido_item_id
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
  LEFT JOIN public.artigos a ON a.id = it.artigo_id
  LEFT JOIN public.variantes_tecido vt ON vt.id = COALESCE(b.variante_tecido_id, it.variante_tecido_id)
  LEFT JOIN public.cores cor ON cor.id = vt.cor_id
  LEFT JOIN public.cores_apelido ap ON ap.id = vt.cor_apelido_id
  LEFT JOIN public.users u ON u.id = b.created_by
  WHERE b.tenant_id = public.get_user_tenant_id() AND b.origem = 'ajuste';
$function$;
