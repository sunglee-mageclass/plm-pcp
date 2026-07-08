-- Rollup de endereços de tecido: fonte de LEITURA consolidada por variante, unindo a tabela
-- enderecamento_tecido (manual + por OC-item) com as colunas do rolo (ocs_tecido.rolo_*).
-- Consumido pela tela de Estoque (📍) e pelo Cadastro (visão consolidada). Escopo = tenant do
-- chamador (get_user_tenant_id() → null/sentinela p/ anon = 0 linhas). origem: manual|oc|rolo.
CREATE OR REPLACE FUNCTION public.enderecos_tecido()
RETURNS TABLE(
  variante_tecido_id uuid,
  rua text,
  prateleira text,
  origem text,
  origem_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- manual (origem nula) + por OC-item (da tabela)
  SELECT et.variante_tecido_id,
         et.rua,
         et.prateleira,
         CASE WHEN et.oc_tecido_item_id IS NOT NULL THEN 'oc' ELSE 'manual' END AS origem,
         CASE WHEN et.oc_tecido_item_id IS NOT NULL THEN 'OC ' || COALESCE(oc.numero_pedido, '—') ELSE '' END AS origem_label
  FROM public.enderecamento_tecido et
  LEFT JOIN public.ocs_tecido_itens oit ON oit.id = et.oc_tecido_item_id
  LEFT JOIN public.ocs_tecido oc ON oc.id = oit.oc_tecido_id
  WHERE et.tenant_id = public.get_user_tenant_id()
    AND et.rolo_id IS NULL

  UNION ALL

  -- por rolo (colunas do rolo — MVP; Fase 2 dobra na tabela). Um rolo é 1 OC (is_rolo) com item(ns).
  SELECT i.variante_tecido_id,
         o.rolo_rua,
         o.rolo_prateleira,
         'rolo' AS origem,
         'Rolo ' || COALESCE(o.rolo_codigo, '—') AS origem_label
  FROM public.ocs_tecido o
  JOIN public.ocs_tecido_itens i ON i.oc_tecido_id = o.id
  WHERE o.tenant_id = public.get_user_tenant_id()
    AND o.is_rolo
    AND (COALESCE(o.rolo_rua, '') <> '' OR COALESCE(o.rolo_prateleira, '') <> '')
$function$;

REVOKE EXECUTE ON FUNCTION public.enderecos_tecido() FROM anon;
GRANT EXECUTE ON FUNCTION public.enderecos_tecido() TO authenticated;
