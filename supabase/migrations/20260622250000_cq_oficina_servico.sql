-- CQ → acesso rápido ao serviço de OFICINA (Terceirizados) p/ lançar desconto/multa
-- antes da oficina entrar no Financeiro (ela só entra após o CQ confirmado).
-- cq_oficina_servico(cad): retorna o bloco de oficina (externo) daquele cad, ou null.
-- cq_set_oficina_desconto_multa(cad, desc, multa): grava desconto/multa nesse bloco.

CREATE OR REPLACE FUNCTION public.cq_oficina_servico(_cad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  SELECT to_jsonb(t) INTO v_out FROM (
    SELECT pt.id,
           COALESCE(ter.nome_responsavel, col.nome, '—') AS responsavel,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)) AS custo_bruto,
           COALESCE(pt.desconto_total,0) AS desconto,
           COALESCE(pt.multa_total,0) AS multa,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) AS custo_liquido,
           GREATEST(COALESCE(pt.numero_parcelas,1),1) AS numero_parcelas,
           pt.data_enviado, pt.data_entregue
    FROM producao_terceirizados pt
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    LEFT JOIN terceirizados ter ON ter.id = pt.terceirizado_id
    LEFT JOIN colaboradores col ON col.id = pt.colaborador_id
    WHERE pt.cad_id = _cad_id AND COALESCE(pt.interno,false) = false
      AND COALESCE(pt.ativo,true) AND COALESCE(ct.nome,'') ILIKE 'oficina'
    ORDER BY pt.created_at
    LIMIT 1
  ) t;
  RETURN v_out;  -- null se não houver bloco de oficina
END;
$function$;

CREATE OR REPLACE FUNCTION public.cq_set_oficina_desconto_multa(_cad_id uuid, _desconto numeric, _multa numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  UPDATE public.producao_terceirizados pt SET
    desconto_total = GREATEST(COALESCE(_desconto,0), 0),
    multa_total = GREATEST(COALESCE(_multa,0), 0)
  FROM public.categorias_terceirizado ct
  WHERE pt.categoria_terceirizado_id = ct.id
    AND pt.cad_id = _cad_id AND COALESCE(pt.interno,false) = false
    AND COALESCE(pt.ativo,true) AND COALESCE(ct.nome,'') ILIKE 'oficina';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cq_oficina_servico(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cq_set_oficina_desconto_multa(uuid, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.cq_oficina_servico(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cq_set_oficina_desconto_multa(uuid, numeric, numeric) TO authenticated;
