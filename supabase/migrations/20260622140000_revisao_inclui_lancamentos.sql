-- Item 13 (Fase 2): #Erro completo. marcar_revisao_por_mudanca marcava
-- terceirizados/oficina/cq/acabamento/direcionamento, mas NÃO lancamentos —
-- então uma mudança de grade/consumo a montante não sinalizava o Lançamento.
-- Adiciona a etapa 'lancamentos'.

CREATE OR REPLACE FUNCTION public.marcar_revisao_por_mudanca(_modelo_id uuid, _grade boolean, _consumo boolean, _aviamentos boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cad uuid; v_etapas text[] := '{}';
BEGIN
  IF v_tenant IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF NOT (_grade OR _consumo OR _aviamentos) THEN RETURN '{}'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT id INTO v_cad FROM public.cad WHERE modelo_id = _modelo_id LIMIT 1;
  IF v_cad IS NULL THEN RETURN '{}'::jsonb; END IF;

  IF EXISTS (SELECT 1 FROM public.producao_terceirizados WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'terceirizados'); END IF;
  IF EXISTS (SELECT 1 FROM public.producao_oficina      WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'oficina'); END IF;
  IF EXISTS (SELECT 1 FROM public.controle_qualidade    WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'cq'); END IF;
  IF EXISTS (SELECT 1 FROM public.producao_acabamento   WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'acabamento'); END IF;
  IF EXISTS (SELECT 1 FROM public.direcionamento        WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'direcionamento'); END IF;
  IF EXISTS (SELECT 1 FROM public.lancamentos           WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'lancamentos'); END IF;

  IF array_length(v_etapas, 1) > 0 THEN
    UPDATE public.modelos
       SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb)
                              || (SELECT jsonb_object_agg(e, true) FROM unnest(v_etapas) e)
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  END IF;
  RETURN COALESCE((SELECT jsonb_object_agg(e, true) FROM unnest(v_etapas) e), '{}'::jsonb);
END;
$function$;
