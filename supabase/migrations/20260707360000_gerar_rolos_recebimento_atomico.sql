-- ALTO (diagnóstico OC Tecido) — parte cirúrgica: o loop de criar_rolo no recebimento rodava
-- best-effort no cliente (fora de transação); falha no meio deixava ROLOS PARCIAIS. Nova RPC
-- gera TODOS os rolos planejados numa transação (tudo-ou-nada): ou cria todos, ou nenhum
-- (o re-save gera de novo). Não toca no diff de itens (fica como está — re-salvável, baixo risco).
-- Padrão wrapper + _core (invariante #9): _core com EXECUTE revogado; wrapper checa o módulo.

CREATE OR REPLACE FUNCTION public._gerar_rolos_recebimento_core(_oc_id uuid, _rolos jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  r jsonb;
  v_rolo_id uuid;
  v_cod text;
  v_n int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ocs_tecido
                 WHERE id = _oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
    RAISE EXCEPTION 'OC não encontrada ou sem permissão';
  END IF;

  -- Cada entrada: { origem_item_id, artigo_id, variante_tecido_id, metragem, obs?, cq_ok?, cq_alerta? }.
  -- O front envia só os rolos NOVOS (sem roloId), com a metragem já convertida p/ metros.
  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_rolos, '[]'::jsonb)) e LOOP
    CONTINUE WHEN NULLIF(r->>'origem_item_id','') IS NULL
              OR NULLIF(r->>'artigo_id','') IS NULL
              OR NULLIF(r->>'variante_tecido_id','') IS NULL
              OR COALESCE((r->>'metragem')::numeric, 0) <= 0;

    -- posse do item de origem pelo tenant (defesa; _criar_rolo_core também valida)
    IF NOT EXISTS (
      SELECT 1 FROM public.ocs_tecido_itens it JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
      WHERE it.id = (r->>'origem_item_id')::uuid AND (oc.tenant_id = v_tenant OR public.is_super_admin())
    ) THEN
      RAISE EXCEPTION 'Item de origem do rolo não pertence à loja';
    END IF;

    v_cod := public.proximo_codigo_rolo((r->>'artigo_id')::uuid);
    v_rolo_id := public._criar_rolo_core(
      v_cod,
      (r->>'artigo_id')::uuid,
      jsonb_build_array(jsonb_build_object(
        'variante_tecido_id', r->>'variante_tecido_id',
        'metragem', (r->>'metragem')::numeric)),
      (r->>'origem_item_id')::uuid,
      NULL, NULL
    );

    -- CQ/observação PLANEJADOS (entrados no encomendado) aplicados ao item do rolo criado.
    IF v_rolo_id IS NOT NULL
       AND (NULLIF(r->>'obs','') IS NOT NULL
            OR COALESCE((r->>'cq_ok')::boolean, false)
            OR COALESCE((r->>'cq_alerta')::boolean, false)) THEN
      UPDATE public.ocs_tecido_itens SET
        cq_observacao = NULLIF(r->>'obs',''),
        cq_ok = COALESCE((r->>'cq_ok')::boolean, false),
        cq_alerta_status = (CASE WHEN COALESCE((r->>'cq_alerta')::boolean, false) THEN 'alertado' ELSE 'sem_alerta' END)::public.cq_alerta_status
      WHERE oc_tecido_id = v_rolo_id;
    END IF;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._gerar_rolos_recebimento_core(uuid, jsonb) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.gerar_rolos_recebimento(_oc_id uuid, _rolos jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  RETURN public._gerar_rolos_recebimento_core(_oc_id, _rolos);
END;
$function$;

select pg_notify('pgrst','reload schema');
