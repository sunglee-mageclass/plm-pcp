-- Quais etapas SEGUINTES um modelo já alcançou (p/ alertar impacto downstream ao
-- editar etapas anteriores, ex.: consumo no Desenvolvimento). Tudo chaveado pelo
-- cad do modelo.
CREATE OR REPLACE FUNCTION public.modelo_etapas_afetadas(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cad uuid;
  v_enviado boolean := false;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT id, COALESCE(enviado_corte, false) INTO v_cad, v_enviado
  FROM public.cad WHERE modelo_id = _modelo_id LIMIT 1;

  IF v_cad IS NULL THEN
    RETURN jsonb_build_object('cad', false);
  END IF;

  RETURN jsonb_build_object(
    'cad', true,
    'corte', v_enviado OR EXISTS (SELECT 1 FROM public.estoque_tecido_baixas WHERE cad_id = v_cad),
    'terceirizados', EXISTS (SELECT 1 FROM public.producao_terceirizados WHERE cad_id = v_cad),
    'oficina', EXISTS (SELECT 1 FROM public.producao_oficina WHERE cad_id = v_cad),
    'cq', EXISTS (SELECT 1 FROM public.controle_qualidade WHERE cad_id = v_cad),
    'acabamento', EXISTS (SELECT 1 FROM public.producao_acabamento WHERE cad_id = v_cad),
    'direcionamento', EXISTS (SELECT 1 FROM public.direcionamento WHERE cad_id = v_cad),
    'lancamentos', EXISTS (SELECT 1 FROM public.lancamentos WHERE cad_id = v_cad OR modelo_id = _modelo_id)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.modelo_etapas_afetadas(uuid) FROM anon;
