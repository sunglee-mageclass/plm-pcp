-- Rollup de endereços de tecido — agora devolve os IDS DE EDIÇÃO para o Cadastro editar
-- cada endereço no lugar certo: endereco_id (linha em enderecamento_tecido, p/ manual+OC) e
-- rolo_id (ocs_tecido, p/ endereço do rolo nas colunas rolo_*). Mesma união de antes.
DROP FUNCTION IF EXISTS public.enderecos_tecido();
CREATE OR REPLACE FUNCTION public.enderecos_tecido()
RETURNS TABLE(
  variante_tecido_id uuid,
  endereco_id uuid,
  rolo_id uuid,
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
  -- manual (origem nula) + por OC-item (linhas da tabela; endereco_id = id da linha)
  SELECT et.variante_tecido_id,
         et.id AS endereco_id,
         NULL::uuid AS rolo_id,
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

  -- por rolo (colunas do rolo; rolo_id = id da OC-rolo, p/ editar as colunas)
  SELECT i.variante_tecido_id,
         NULL::uuid AS endereco_id,
         o.id AS rolo_id,
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
