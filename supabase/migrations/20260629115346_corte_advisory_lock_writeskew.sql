-- R1: fecha o write-skew no envio ao corte (reproduzido em 2 conexoes concorrentes).
-- Adiciona pg_advisory_xact_lock por tenant no _core; resto do corpo inalterado.

CREATE OR REPLACE FUNCTION public._baixar_estoque_tecido_corte_core(_cad_id uuid)
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
  v_deficit jsonb := '[]'::jsonb;
  v_deficit_total numeric := 0;
  v_var_label text;
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

  -- R1 fix (write-skew): serializa cortes do mesmo tenant para fechar a janela de
  -- leitura de saldo (saldo_oc_item_m e READ COMMITTED sem lock). 2 cortes simultaneos
  -- no mesmo lote liam o saldo cheio e baixavam a mais. Mesmo padrao de recalcular_parcelas;
  -- deadlock-free (1 lock por tenant); perfil de uso e manual/sequencial.
  PERFORM pg_advisory_xact_lock(hashtext('corte_tenant:' || v_tenant::text));

  -- Atômico: marca o envio ao corte na mesma transação da baixa.
  UPDATE public.cad
     SET enviado_corte = true,
         status_corte = 'enviado',
         data_enviado_corte = COALESCE(data_enviado_corte, current_date)
   WHERE id = _cad_id;

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

    -- Déficit: o que não pôde ser baixado dessa variante (faltou saldo).
    IF v_restante > 0.0001 THEN
      SELECT nome_variante INTO v_var_label FROM public.variantes_tecido WHERE id = r.variante_tecido_id;
      v_deficit := v_deficit || jsonb_build_object(
        'tipo', r.tipo,
        'numero', r.numero,
        'ordem', r.ordem,
        'variante', COALESCE(v_var_label, r.variante_tecido_id::text),
        'enviada', r.metragem_enviada,
        'baixada', round(r.metragem_enviada - v_restante, 4),
        'deficit', round(v_restante, 4)
      );
      v_deficit_total := v_deficit_total + v_restante;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'linhas', v_total_linhas,
    'quantidade', v_total_qtd,
    'deficit_total', round(v_deficit_total, 4),
    'deficit', v_deficit
  );
END;
$function$;
