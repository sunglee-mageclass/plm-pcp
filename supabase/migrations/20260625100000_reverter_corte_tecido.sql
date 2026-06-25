-- Reversão TRANSACIONAL do envio ao corte (espelha baixar_estoque_tecido_corte / P0-2).
-- Antes o "desmarcar envio" era 2 chamadas separadas no cliente (DELETE no ledger
-- estoque_tecido_baixas + UPDATE cad): se a 2ª falhasse após a 1ª, a baixa sumia mas
-- enviado_corte ficava true → estoque inflado (reserva liberada) e CAD travado, sem
-- trilha. Agora as duas operações ocorrem numa única transação na RPC.
CREATE OR REPLACE FUNCTION public._reverter_corte_tecido_core(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;

  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  DELETE FROM public.estoque_tecido_baixas WHERE cad_id = _cad_id;

  UPDATE public.cad
     SET enviado_corte = false,
         status_corte = 'pendente',
         data_enviado_corte = NULL
   WHERE id = _cad_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverter_corte_tecido(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._reverter_corte_tecido_core(_cad_id);
END $function$;

REVOKE EXECUTE ON FUNCTION public._reverter_corte_tecido_core(uuid) FROM public, anon, authenticated;
