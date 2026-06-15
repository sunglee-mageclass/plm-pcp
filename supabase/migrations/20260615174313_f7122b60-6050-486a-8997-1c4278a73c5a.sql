-- Restrict saldo_oc_item_m to caller's tenant (super_admin still bypasses)
CREATE OR REPLACE FUNCTION public.saldo_oc_item_m(_item_id uuid)
RETURNS TABLE(saldo_m numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT i.id, i.variante_tecido_id, i.quantidade_recebida,
           a.unidade_medida, COALESCE(a.rendimento,0) AS rendimento,
           oc.tenant_id
    FROM public.ocs_tecido_itens i
    JOIN public.ocs_tecido oc ON oc.id = i.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = i.artigo_id
    WHERE i.id = _item_id
      AND (oc.tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  ),
  rec AS (
    SELECT CASE WHEN unidade_medida='kg'
                THEN COALESCE(quantidade_recebida,0) * rendimento
                ELSE COALESCE(quantidade_recebida,0) END AS m
    FROM it
  ),
  bx AS (
    SELECT COALESCE(SUM(quantidade),0) AS m
    FROM public.estoque_tecido_baixas
    WHERE oc_tecido_item_id = _item_id
      AND EXISTS (SELECT 1 FROM it)
  )
  SELECT (SELECT m FROM rec) - (SELECT m FROM bx)
  WHERE EXISTS (SELECT 1 FROM it);
$$;

-- Authorize baixar_estoque_tecido_corte against caller's tenant
CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_modelo uuid;
  v_total_linhas int := 0;
  v_total_qtd numeric := 0;
  r record;
  v_restante numeric;
  v_link_oc_item uuid;
  v_saldo numeric;
  v_consumir numeric;
  lote record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id, modelo_id INTO v_tenant, v_modelo
  FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;

  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  DELETE FROM public.estoque_tecido_baixas WHERE cad_id = _cad_id;

  FOR r IN
    SELECT ct.tipo, ct.numero, ctv.variante_tecido_id, ctv.ordem, ctv.metragem_enviada
    FROM public.cad_tecidos ct
    JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
    WHERE ct.cad_id = _cad_id
      AND COALESCE(ctv.metragem_enviada,0) > 0
      AND ctv.variante_tecido_id IS NOT NULL
  LOOP
    v_restante := r.metragem_enviada;

    SELECT oc_tecido_item_id INTO v_link_oc_item
    FROM public.modelo_tecido_oc_links
    WHERE modelo_id = v_modelo
      AND tipo = r.tipo AND numero = r.numero AND ordem = r.ordem
      AND variante_tecido_id = r.variante_tecido_id;

    IF v_link_oc_item IS NOT NULL THEN
      SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(v_link_oc_item);
      v_saldo := COALESCE(v_saldo,0);
      IF v_saldo > 0 THEN
        v_consumir := LEAST(v_restante, v_saldo);
        INSERT INTO public.estoque_tecido_baixas
          (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
        VALUES (v_tenant, _cad_id, r.variante_tecido_id, v_link_oc_item, v_consumir, 'vinculo');
        v_restante := v_restante - v_consumir;
        v_total_linhas := v_total_linhas + 1;
        v_total_qtd := v_total_qtd + v_consumir;
      END IF;
    END IF;

    IF v_restante > 0 THEN
      FOR lote IN
        SELECT it.id AS item_id, s.saldo_m
        FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        CROSS JOIN LATERAL public.saldo_oc_item_m(it.id) s
        WHERE oc.tenant_id = v_tenant
          AND oc.status = 'recebido'
          AND it.variante_tecido_id = r.variante_tecido_id
          AND s.saldo_m > 0
          AND (v_link_oc_item IS NULL OR it.id <> v_link_oc_item)
        ORDER BY oc.data_entrega NULLS LAST, oc.created_at
      LOOP
        EXIT WHEN v_restante <= 0;
        v_consumir := LEAST(v_restante, lote.saldo_m);
        INSERT INTO public.estoque_tecido_baixas
          (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
        VALUES (v_tenant, _cad_id, r.variante_tecido_id, lote.item_id, v_consumir, 'fifo');
        v_restante := v_restante - v_consumir;
        v_total_linhas := v_total_linhas + 1;
        v_total_qtd := v_total_qtd + v_consumir;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('linhas', v_total_linhas, 'quantidade', v_total_qtd);
END;
$$;