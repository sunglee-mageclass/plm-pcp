-- Reverte os rolos criados a partir do recebimento de uma OC (modo Só Rolo) quando a
-- OC é DESMARCADA como recebida. Sem isso os rolos ficavam órfãos (separação aplicada,
-- mas OC não-recebida) e re-receber DUPLICAVA. Remove a baixa 'separacao_rolo' (que os
-- criou, restaurando o saldo da origem), os itens do rolo e o próprio rolo. Bloqueia se
-- algum rolo já foi consumido adiante (baixa com o item do rolo como origem).
CREATE OR REPLACE FUNCTION public._reverter_rolos_oc_core(_oc_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_rolos uuid[];
  v_rolo_itens uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _oc_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'OC não encontrada'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;

  -- Rolos criados a partir dos itens desta OC.
  SELECT array_agg(r.id) INTO v_rolos
  FROM public.ocs_tecido r
  WHERE r.is_rolo = true
    AND r.tenant_id = v_tenant
    AND r.rolo_origem_item_id IN (SELECT id FROM public.ocs_tecido_itens WHERE oc_tecido_id = _oc_id);

  IF v_rolos IS NULL OR array_length(v_rolos, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT array_agg(id) INTO v_rolo_itens
  FROM public.ocs_tecido_itens WHERE oc_tecido_id = ANY(v_rolos);

  -- Bloqueia se algum rolo já foi consumido/separado adiante (baixa usando o item do
  -- rolo como ORIGEM) — reverter apagaria histórico de consumo real.
  IF v_rolo_itens IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.estoque_tecido_baixas
    WHERE oc_tecido_item_id = ANY(v_rolo_itens)
  ) THEN
    RAISE EXCEPTION 'Há rolo(s) desta OC já em uso; desfaça o uso antes de desmarcar o recebimento.';
  END IF;

  -- Remove a baixa de separação (que criou os rolos, restaurando o saldo da origem),
  -- depois os itens e os rolos.
  DELETE FROM public.estoque_tecido_baixas WHERE rolo_id = ANY(v_rolos);
  DELETE FROM public.ocs_tecido_itens WHERE oc_tecido_id = ANY(v_rolos);
  DELETE FROM public.ocs_tecido WHERE id = ANY(v_rolos);

  RETURN array_length(v_rolos, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverter_rolos_oc(_oc_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  RETURN public._reverter_rolos_oc_core(_oc_id);
END $function$;

REVOKE EXECUTE ON FUNCTION public._reverter_rolos_oc_core(uuid) FROM public, anon, authenticated;
