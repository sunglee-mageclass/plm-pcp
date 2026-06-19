-- Liga a baixa de separação ao rolo, com ON DELETE CASCADE: apagar o rolo
-- apaga a baixa de separação e devolve a metragem à OC de origem.
ALTER TABLE public.estoque_tecido_baixas
  ADD COLUMN IF NOT EXISTS rolo_id uuid REFERENCES public.ocs_tecido(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.criar_rolo(
  _codigo text,
  _artigo_id uuid,
  _variantes jsonb,
  _origem_item_id uuid DEFAULT NULL::uuid
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rolo_id uuid;
  v_unidade text;
  v_rend numeric;
  v_item jsonb;
  v_var uuid;
  v_metragem numeric;
  v_qtd numeric;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT unidade_medida, COALESCE(rendimento,0) INTO v_unidade, v_rend
  FROM public.artigos WHERE id = _artigo_id;

  INSERT INTO public.ocs_tecido (tenant_id, is_rolo, rolo_codigo, rolo_origem_item_id,
                                 status, data_pedido, data_entrega, numero_pedido)
  VALUES (v_tenant, true, _codigo, _origem_item_id, 'recebido', current_date, current_date,
          COALESCE(NULLIF(_codigo,''), 'ROLO'))
  RETURNING id INTO v_rolo_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes, '[]'::jsonb)) LOOP
    v_var := NULLIF(v_item->>'variante_tecido_id','')::uuid;
    v_metragem := COALESCE((v_item->>'metragem')::numeric, 0);
    IF v_var IS NULL OR v_metragem <= 0 THEN CONTINUE; END IF;

    -- O estoque trabalha em METROS; para artigo em kg, guarda em kg (÷ rendimento)
    -- pois o motor multiplica por rendimento ao ler.
    v_qtd := CASE WHEN v_unidade = 'kg' AND v_rend > 0 THEN v_metragem / v_rend ELSE v_metragem END;

    INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id,
                                         quantidade_pedida, quantidade_recebida)
    VALUES (v_rolo_id, _artigo_id, v_var, v_qtd, v_qtd);

    -- Separação: tira a metragem (em metros) do item de origem via baixa, ligada
    -- ao rolo (ON DELETE CASCADE devolve à OC se o rolo for apagado).
    IF _origem_item_id IS NOT NULL THEN
      INSERT INTO public.estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id,
                                                variante_tecido_id, quantidade, origem, rolo_id)
      VALUES (v_tenant, NULL, _origem_item_id, v_var, v_metragem, 'separacao_rolo', v_rolo_id);
    END IF;
  END LOOP;

  RETURN v_rolo_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.criar_rolo(text, uuid, jsonb, uuid) FROM anon;

-- Permite a origem 'separacao_rolo' na baixa.
ALTER TABLE public.estoque_tecido_baixas DROP CONSTRAINT IF EXISTS estoque_tecido_baixas_origem_check;
ALTER TABLE public.estoque_tecido_baixas ADD CONSTRAINT estoque_tecido_baixas_origem_check
  CHECK (origem = ANY (ARRAY['vinculo'::text, 'fifo'::text, 'separacao_rolo'::text]));
