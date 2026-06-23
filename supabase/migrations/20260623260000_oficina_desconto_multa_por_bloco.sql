-- cq_set_oficina_desconto_multa gravava desconto/multa em TODOS os blocos de
-- categoria 'oficina' do CAD (UPDATE por categoria, sem id) — com 2+ blocos de
-- oficina, corrompia custo líquido/parcelas dos demais. O dialog do CQ mostra e
-- edita SÓ um bloco (cq_oficina_servico faz ORDER BY created_at LIMIT 1).
-- Correção: o UPDATE passa a mirar exatamente esse MESMO bloco único (mesma
-- ordenação), nunca todos. Sem mudar assinatura nem o front.

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
  WHERE pt.id = (
    SELECT pt2.id
    FROM public.producao_terceirizados pt2
    JOIN public.categorias_terceirizado ct ON ct.id = pt2.categoria_terceirizado_id
    WHERE pt2.cad_id = _cad_id AND COALESCE(pt2.interno,false) = false
      AND COALESCE(pt2.ativo,true) AND COALESCE(ct.nome,'') ILIKE 'oficina'
    ORDER BY pt2.created_at
    LIMIT 1
  );
END;
$function$;
