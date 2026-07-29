-- Excluir OC de tecido SÓ via RPC com guarda (invariantes #5 + #9).
-- O `.delete()` cru em ocs_tecido cascateava ocs_tecido_itens → estoque_tecido_baixas (LEDGER),
-- modelo_tecido_oc_links (vínculos de Dev), enderecamento_tecido e os hints do plano — apagando
-- tudo em SILÊNCIO. A guarda bloqueia OC em uso; livre, apaga parcelas (FK NO ACTION) + a OC.

CREATE OR REPLACE FUNCTION public._excluir_oc_tecido_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.ocs_tecido WHERE id = _oc_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- 1) OC recebida = tem estoque no ledger
  IF v_status = 'recebido' THEN
    RAISE EXCEPTION 'Não é possível excluir: OC já recebida (tem estoque). Estorne o recebimento antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 2) baixa de estoque registrada (por item OU por rolo derivado desta OC)
  IF EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b JOIN public.ocs_tecido_itens it ON it.id = b.oc_tecido_item_id WHERE it.oc_tecido_id = _oc_id)
     OR EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b WHERE b.rolo_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem baixa de estoque registrada.' USING ERRCODE = 'P0001';
  END IF;

  -- 3) vínculo de Desenvolvimento (modelo_tecido_oc_links)
  IF EXISTS (SELECT 1 FROM public.modelo_tecido_oc_links l JOIN public.ocs_tecido_itens it ON it.id = l.oc_tecido_item_id WHERE it.oc_tecido_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC está vinculada a modelo(s) no Desenvolvimento. Desvincule antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 4) rolo(s) derivado(s) desta OC
  IF EXISTS (SELECT 1 FROM public.ocs_tecido r JOIN public.ocs_tecido_itens it ON it.id = r.rolo_origem_item_id WHERE it.oc_tecido_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem rolo(s) derivado(s). Exclua os rolos antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 5) parcela paga no financeiro
  IF EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_tecido_id = _oc_id AND p.status = 'pago') THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem parcela paga no financeiro.' USING ERRCODE = 'P0001';
  END IF;

  -- LIVRE: apaga parcelas (FK NO ACTION, senão o DELETE da OC falha) e a OC. O restante (hints do
  -- plano, endereçamento de OC não-recebida) cascateia sem perda relevante.
  DELETE FROM public.parcelas WHERE oc_tecido_id = _oc_id;
  DELETE FROM public.ocs_tecido WHERE id = _oc_id AND tenant_id = v_tenant;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._excluir_oc_tecido_core(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.excluir_oc_tecido(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._excluir_oc_tecido_core(_oc_id);
END
$function$;
