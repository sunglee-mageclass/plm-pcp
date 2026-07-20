-- Item 1: marcar_revisao_por_mudanca acendia #Erro em TODAS as etapas posteriores para
-- qualquer edição (grade/consumo/aviamento), forçando re-fazer CQ/Direcionamento mesmo quando
-- a mudança não os afetava. Pelo domínio: só a GRADE (nº de peças) afeta as etapas de PEÇA
-- (Serviços/Oficina/CQ/Direcionamento/Lançamentos). Consumo/aviamento afetam só a metragem do
-- CORTE (Explosão) — que não é uma flag de #Erro (a Explosão fica na lista, reenviável). Então
-- só a grade acende as flags; consumo/aviamento sozinhos não forçam retrabalho nas peças.
BEGIN;

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

  -- Só a GRADE afeta as etapas de PEÇA (quantidades/split por peça). Consumo/aviamento afetam
  -- apenas a metragem do corte (Explosão), tratada por reenvio — sem flag de #Erro aqui.
  IF _grade THEN
    IF EXISTS (SELECT 1 FROM public.producao_terceirizados WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'terceirizados'); END IF;
    IF EXISTS (SELECT 1 FROM public.producao_oficina      WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'oficina'); END IF;
    IF EXISTS (SELECT 1 FROM public.controle_qualidade    WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'cq'); END IF;
    IF EXISTS (SELECT 1 FROM public.direcionamento        WHERE cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'direcionamento'); END IF;
    -- Fonte única (tabela lancamentos aposentada): modelos.lancado.
    IF (SELECT COALESCE(lancado, false) FROM public.modelos WHERE id = _modelo_id) THEN v_etapas := array_append(v_etapas, 'lancamentos'); END IF;
  END IF;

  IF array_length(v_etapas, 1) > 0 THEN
    UPDATE public.modelos
       SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb)
                              || (SELECT jsonb_object_agg(e, true) FROM unnest(v_etapas) e)
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  END IF;
  RETURN COALESCE((SELECT jsonb_object_agg(e, true) FROM unnest(v_etapas) e), '{}'::jsonb);
END;
$function$;

COMMIT;
