-- Fase 2 importado: o wrapper recalcular_parcelas aceita o tipo 'p_importado' (resolve tenant de
-- ocs_importado). O _core já ganhou o ramo em 20260905170000. Idempotente.

BEGIN;

CREATE OR REPLACE FUNCTION public.recalcular_parcelas(_oc_id uuid, _tipo text)
 RETURNS jsonb
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
  IF _tipo NOT IN ('tecido','aviamento','p_acabado','p_importado') THEN
    RAISE EXCEPTION 'tipo deve ser tecido, aviamento, p_acabado ou p_importado';
  END IF;
  IF _tipo = 'tecido' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_tecido WHERE id = _oc_id;
  ELSIF _tipo = 'aviamento' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_aviamento WHERE id = _oc_id;
  ELSIF _tipo = 'p_importado' THEN
    SELECT tenant_id INTO v_tenant FROM public.ocs_importado WHERE id = _oc_id;
  ELSE
    SELECT tenant_id INTO v_tenant FROM public.ocs_p_acabado WHERE id = _oc_id;
  END IF;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para esta OC';
  END IF;
  RETURN public._recalcular_parcelas_core(_oc_id, _tipo);
END;
$function$;

COMMIT;
