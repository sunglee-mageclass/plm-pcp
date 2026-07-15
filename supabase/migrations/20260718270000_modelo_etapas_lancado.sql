-- modelo_etapas_afetadas — reapontar 'lancamentos' p/ a fonte única (audit de saúde jul/2026).
-- ANTES: a etapa 'lancamentos' do alerta de impacto downstream lia EXISTS(lancamentos) — tabela
-- APOSENTADA desde 18/jun (nada mais a popula), então o alerta era CEGO p/ modelos lançados.
-- Fonte única de "Lançado" = modelos.lancado (invariante #6). Só troca essa linha.

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
    'baixa_total', COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE cad_id = v_cad), 0),
    'terceirizados', EXISTS (SELECT 1 FROM public.producao_terceirizados WHERE cad_id = v_cad),
    'oficina', EXISTS (SELECT 1 FROM public.producao_oficina WHERE cad_id = v_cad),
    'cq', EXISTS (SELECT 1 FROM public.controle_qualidade WHERE cad_id = v_cad),
    'direcionamento', EXISTS (SELECT 1 FROM public.direcionamento WHERE cad_id = v_cad),
    -- Fonte única (tabela lancamentos aposentada): modelos.lancado.
    'lancamentos', COALESCE((SELECT lancado FROM public.modelos WHERE id = _modelo_id), false)
  );
END;
$function$;

select pg_notify('pgrst','reload schema');
