-- 20260721130000_sidebar_badges_otb_divergencia.sql
CREATE OR REPLACE FUNCTION public.sidebar_badges()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_tz text; v_hoje date;
  v_prontos int; v_alertas int; v_oc_tec int; v_oc_avi int; v_oc_etq int; v_otb int := 0;
BEGIN
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RETURN jsonb_build_object('prontos_lancar',0,'alertas_tecido',0,'oc_tecido_atrasada',0,
                              'oc_aviamento_atrasada',0,'oc_etiqueta_atrasada',0,'otb_divergencia',0);
  END IF;

  SELECT NULLIF(btrim(timezone),'') INTO v_tz FROM public.tenant_config WHERE tenant_id = v_tenant;
  v_tz := COALESCE(v_tz,'America/Sao_Paulo');
  v_hoje := (now() AT TIME ZONE v_tz)::date;

  SELECT count(*) INTO v_prontos FROM public.modelos m
  WHERE m.tenant_id = v_tenant AND COALESCE(m.lancado,false) = false
    AND EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.tenant_id = v_tenant
      AND public._cq_liberado(c.id)
      AND NOT EXISTS (SELECT 1 FROM public.producao_terceirizados pt
        WHERE pt.cad_id = c.id AND COALESCE(pt.interno,false) = false AND COALESCE(pt.aprovado,false) = false));

  SELECT count(*) INTO v_alertas FROM public.ocs_tecido_itens it
  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = v_tenant
  WHERE it.cq_alerta_status IN ('alertado','troca_pendente');

  SELECT count(*) INTO v_oc_tec FROM public.ocs_tecido oc
  WHERE oc.tenant_id = v_tenant AND oc.status = 'encomendado' AND COALESCE(oc.is_rolo,false) = false
    AND oc.data_prevista_entrega IS NOT NULL AND oc.data_prevista_entrega < v_hoje;

  SELECT count(*) INTO v_oc_avi FROM public.ocs_aviamento oc
  WHERE oc.tenant_id = v_tenant AND oc.status = 'encomendado'
    AND oc.data_prevista_entrega IS NOT NULL AND oc.data_prevista_entrega < v_hoje;

  SELECT count(*) INTO v_oc_etq FROM public.ocs_etiqueta oc
  WHERE oc.tenant_id = v_tenant AND oc.status = 'encomendado'
    AND oc.data_prevista_entrega IS NOT NULL AND oc.data_prevista_entrega < v_hoje;

  -- OTB: coleções confirmadas onde os cards passaram do plano (só se o módulo está on).
  IF public.tenant_module_enabled('otb') THEN
    SELECT count(*) INTO v_otb FROM public._otb_colecao_totais(v_tenant) t WHERE t.realizado > t.total;
  END IF;

  RETURN jsonb_build_object(
    'prontos_lancar', COALESCE(v_prontos,0), 'alertas_tecido', COALESCE(v_alertas,0),
    'oc_tecido_atrasada', COALESCE(v_oc_tec,0), 'oc_aviamento_atrasada', COALESCE(v_oc_avi,0),
    'oc_etiqueta_atrasada', COALESCE(v_oc_etq,0), 'otb_divergencia', COALESCE(v_otb,0));
END $function$;
