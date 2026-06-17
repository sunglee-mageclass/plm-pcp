-- Baixa de tecido no corte parametrizada pelo modo (tenant_config.modo_baixa_estoque).
-- 'por_oc'     = vínculo modelo↔OC primeiro (por prioridade/quantidade_m), FIFO no resto.
-- 'automatico' = FIFO puro (estoque mais velho por data_entrega/created_at), ignora vínculos.
-- Única diferença vs versão anterior: lê v_modo e o bloco de vínculos só roda em 'por_oc'.
CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_modelo uuid;
  v_modo text;
  v_total_linhas int := 0;
  v_total_qtd numeric := 0;
  r record;
  v_restante numeric;
  v_saldo numeric;
  v_consumir numeric;
  v_limite numeric;
  vlink record;
  lote record;
  v_used_ids uuid[];
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

  SELECT COALESCE(modo_baixa_estoque, 'por_oc') INTO v_modo
  FROM public.tenant_config WHERE tenant_id = v_tenant;
  v_modo := COALESCE(v_modo, 'por_oc');

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
    v_used_ids := ARRAY[]::uuid[];

    -- Fase 1: vínculos explícitos — somente no modo 'por_oc'.
    IF v_modo = 'por_oc' THEN
      FOR vlink IN
        SELECT oc_tecido_item_id, COALESCE(quantidade_m,0) AS quantidade_m, COALESCE(prioridade,1) AS prioridade
        FROM public.modelo_tecido_oc_links
        WHERE modelo_id = v_modelo
          AND tipo = r.tipo AND numero = r.numero AND ordem = r.ordem
          AND variante_tecido_id = r.variante_tecido_id
        ORDER BY prioridade, oc_tecido_item_id
      LOOP
        EXIT WHEN v_restante <= 0;
        v_used_ids := array_append(v_used_ids, vlink.oc_tecido_item_id);
        SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(vlink.oc_tecido_item_id);
        v_saldo := COALESCE(v_saldo,0);
        IF v_saldo <= 0 THEN CONTINUE; END IF;
        v_limite := CASE WHEN vlink.quantidade_m > 0 THEN vlink.quantidade_m ELSE v_restante END;
        v_consumir := LEAST(v_restante, v_saldo, v_limite);
        IF v_consumir <= 0 THEN CONTINUE; END IF;
        INSERT INTO public.estoque_tecido_baixas
          (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
        VALUES (v_tenant, _cad_id, r.variante_tecido_id, vlink.oc_tecido_item_id, v_consumir, 'vinculo');
        v_restante := v_restante - v_consumir;
        v_total_linhas := v_total_linhas + 1;
        v_total_qtd := v_total_qtd + v_consumir;
      END LOOP;
    END IF;

    -- Fase 2: FIFO (estoque mais velho). Em 'automatico', consome tudo por aqui.
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
          AND NOT (it.id = ANY(v_used_ids))
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
$function$;

NOTIFY pgrst, 'reload schema';
