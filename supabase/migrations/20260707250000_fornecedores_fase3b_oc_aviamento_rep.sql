-- FORNECEDORES — FASE 3b (schema): OC Aviamento aceita representante_id.
-- _salvar_oc_aviamento_core tem whitelist fixa de colunas — sem isto o representante_id
-- do payload era silenciosamente ignorado. Adiciona no INSERT (colunas+values) e no UPDATE.
-- OC Tecido não precisa (escrita direta na tabela). Trava mesmo-tenant do rep já existe (F0).

CREATE OR REPLACE FUNCTION public._salvar_oc_aviamento_core(_oc_id uuid, _oc jsonb, _itens jsonb)
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

  IF v_oc_id IS NULL THEN
    -- INSERT: cria como 'encomendado' (trigger não gera parcela), itens, depois status final.
    INSERT INTO public.ocs_aviamento
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status)
    VALUES
      (v_tenant, _oc->>'numero_pedido', _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1), _oc->>'nf_url',
       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado')
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'aviamento_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_aviamento SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_aviamento
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    -- diff de itens por id (preserva ids). keep = ids enviados.
    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL);
    DELETE FROM public.ocs_aviamento_itens
      WHERE oc_aviamento_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_aviamento_itens SET
        aviamento_id = (r->>'aviamento_id')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false)
      WHERE id = (r->>'id')::uuid AND oc_aviamento_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'aviamento_id' IS NOT NULL;

    -- update da OC (dispara o trigger já com itens corretos)
    UPDATE public.ocs_aviamento SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  -- Recalcula parcelas quando recebida (preserva pagas; o trigger não regenera se já existe).
  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'aviamento');
  END IF;

  RETURN v_oc_id;
END;
$function$;

select pg_notify('pgrst', 'reload schema');
