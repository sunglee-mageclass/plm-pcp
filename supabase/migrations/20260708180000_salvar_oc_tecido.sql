-- OC Tecido: save ATÔMICO (fecha o ALTO "save não-atômico" do diagnóstico).
--
-- O save do OC Tecido eram 6-8 chamadas no cliente (delete/update/insert de itens + update da
-- OC + recalcular_parcelas), com janela de falha parcial. Vira 1 transação, espelhando o
-- salvar_oc_aviamento: itens ANTES do status='recebido' (o trigger gerar_parcelas lê os itens
-- no UPDATE), diff por id preservando cq_*/estoque_zerado/substitui_item_id, e recálculo de
-- parcelas no fim (preserva pagas). A GERAÇÃO DE ROLOS (modo rolo) continua fora, pós-save
-- (gerar_rolos_recebimento já é atômica e best-effort — precisa dos itens já gravados).

CREATE OR REPLACE FUNCTION public._salvar_oc_tecido_core(_oc_id uuid, _oc jsonb, _itens jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_oc_id uuid := _oc_id;
  v_status text := COALESCE(_oc->>'status', 'encomendado');
  v_recebido boolean := (_oc->>'status' = 'recebido');
  v_keep uuid[];
  r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- itens não podem referenciar tecido (artigo) de outra loja (defesa contra payload forjado;
  -- a empresa da OC já é validada pelo trigger enforce_empresa_tenant).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    JOIN public.artigos a ON a.id = (e->>'artigo_id')::uuid
    WHERE e->>'artigo_id' IS NOT NULL AND a.tenant_id IS DISTINCT FROM v_tenant
  ) THEN
    RAISE EXCEPTION 'Tecido de outra loja não pode ser adicionado à OC.';
  END IF;

  IF v_oc_id IS NULL THEN
    INSERT INTO public.ocs_tecido
      (tenant_id, numero_pedido, responsavel_id, responsavel_nome, empresa_id, representante_id,
       data_pedido, data_prevista_entrega, data_entrega, prazo_pagamento, quantidade_prazos,
       observacoes_entrega, observacoes_defeitos, anexo_pedido_url, modelo_sugerido_url, nf_url,
       parcelas_recebimento, valor_previsto_total, valor_real_total, status)
    VALUES
      (v_tenant, _oc->>'numero_pedido', (_oc->>'responsavel_id')::uuid, _oc->>'responsavel_nome',
       (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1),
       _oc->>'observacoes_entrega', _oc->>'observacoes_defeitos', _oc->>'anexo_pedido_url',
       _oc->>'modelo_sugerido_url', _oc->>'nf_url', COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
       COALESCE((_oc->>'valor_previsto_total')::numeric, 0), COALESCE((_oc->>'valor_real_total')::numeric, 0),
       'encomendado')
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida,
       quantidade_recebida, rendimento, cancelado, rolos_planejados)
    SELECT v_oc_id, (e->>'artigo_id')::uuid, (e->>'artigo_numero')::int, (e->>'variante_tecido_id')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           (e->>'rendimento')::numeric, COALESCE((e->>'cancelado')::boolean, false), e->'rolos_planejados'
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_tecido SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_tecido
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    -- diff por id (preserva ids e os campos que o save NÃO toca: cq_*, estoque_zerado, substitui_item_id)
    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL);
    DELETE FROM public.ocs_tecido_itens WHERE oc_tecido_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_tecido_itens SET
        artigo_id = (r->>'artigo_id')::uuid,
        artigo_numero = (r->>'artigo_numero')::int,
        variante_tecido_id = (r->>'variante_tecido_id')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        rendimento = (r->>'rendimento')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false),
        rolos_planejados = r->'rolos_planejados'
      WHERE id = (r->>'id')::uuid AND oc_tecido_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_tecido_itens
      (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida,
       quantidade_recebida, rendimento, cancelado, rolos_planejados)
    SELECT v_oc_id, (e->>'artigo_id')::uuid, (e->>'artigo_numero')::int, (e->>'variante_tecido_id')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           (e->>'rendimento')::numeric, COALESCE((e->>'cancelado')::boolean, false), e->'rolos_planejados'
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'variante_tecido_id' IS NOT NULL AND e->>'artigo_id' IS NOT NULL;

    UPDATE public.ocs_tecido SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_id = (_oc->>'responsavel_id')::uuid,
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      observacoes_entrega = _oc->>'observacoes_entrega',
      observacoes_defeitos = _oc->>'observacoes_defeitos',
      anexo_pedido_url = _oc->>'anexo_pedido_url',
      modelo_sugerido_url = _oc->>'modelo_sugerido_url',
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      valor_previsto_total = COALESCE((_oc->>'valor_previsto_total')::numeric, 0),
      valor_real_total = COALESCE((_oc->>'valor_real_total')::numeric, 0),
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'tecido');
  END IF;

  RETURN v_oc_id;
END;
$function$;

-- Wrapper: gate de módulo. _core sem EXECUTE p/ PUBLIC/anon/authenticated (invariante #9 —
-- os TRÊS: PUBLIC concede por default e anon/authenticated herdam dele).
CREATE OR REPLACE FUNCTION public.salvar_oc_tecido(_oc_id uuid, _oc jsonb, _itens jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._salvar_oc_tecido_core(_oc_id, _oc, _itens);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._salvar_oc_tecido_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_oc_tecido(uuid, jsonb, jsonb) TO authenticated;
