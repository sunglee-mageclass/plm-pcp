-- Desmarcar recebimento de OC (tecido/aviamento) atômico (audit de saúde jul/2026, invariante #1/#4).
-- ANTES: o front fazia 2-3 escritas separadas sem transação — (tecido) reverter_rolos_oc + UPDATE
-- status + DELETE parcelas; (aviamento) UPDATE status + DELETE parcelas. Se um passo do meio
-- falhava (rede/RLS), a OC ficava em estado parcial (ex.: rolos revertidos mas OC ainda 'recebido',
-- ou status voltou mas parcelas ficaram). Fix: uma RPC que faz tudo numa txn. Espelha salvar_oc_tecido.
-- Fiel ao front: só reverte rolos quando o modo da loja != 'oc' (senão é no-op de qualquer forma —
-- _reverter_rolos_oc_core só age em rolos originados desta OC e bloqueia se algum já está em uso).

CREATE OR REPLACE FUNCTION public._desmarcar_recebimento_oc_core(_tipo text, _oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_modo text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF _tipo NOT IN ('tecido','aviamento') THEN RAISE EXCEPTION 'Tipo de OC inválido'; END IF;

  IF _tipo = 'tecido' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _oc_id;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.ocs_aviamento WHERE id = _oc_id;
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'OC não encontrada'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;

  IF _tipo = 'tecido' THEN
    SELECT COALESCE(modo_oc_rolo,'ambos') INTO v_modo FROM public.tenant_config WHERE tenant_id = v_tenant;
    IF COALESCE(v_modo,'ambos') <> 'oc' THEN
      -- Se algum rolo desta OC já está em uso, isto RAISEa e reverte TUDO (a OC segue recebida).
      PERFORM public._reverter_rolos_oc_core(_oc_id);
    END IF;
    UPDATE public.ocs_tecido SET status = 'encomendado' WHERE id = _oc_id;
    DELETE FROM public.parcelas
     WHERE oc_tecido_id = _oc_id AND status <> 'pago' AND data_pagamento IS NULL;
  ELSE
    UPDATE public.ocs_aviamento SET status = 'encomendado' WHERE id = _oc_id;
    DELETE FROM public.parcelas
     WHERE oc_aviamento_id = _oc_id AND status <> 'pago' AND data_pagamento IS NULL;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._desmarcar_recebimento_oc_core(text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.desmarcar_recebimento_oc(_tipo text, _oc_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._desmarcar_recebimento_oc_core(_tipo, _oc_id);
END $function$;

select pg_notify('pgrst','reload schema');
