-- Direcionamento multi-lojas — fix pós-Task 7 (achado da verificação final, mesma classe do gate
-- do trigger da Task 2, `fn_rebaixa_direcionamento_grade`): `modelo_etapas_afetadas` e
-- `marcar_revisao_por_mudanca` gateavam a etapa 'direcionamento' com `EXISTS(direcionamento)` —
-- SÓ a tabela LEGADA. Desde a Task 3 (core v2), nenhum save novo escreve mais em `direcionamento`
-- (só em `direcionamento_lojas`); um CAD cujo Direcionamento nasceu inteiramente no modelo novo
-- não tinha `hasDownstream.direcionamento` aceso nem acendia o `#Erro` da etapa quando a grade
-- mudava a montante (Desenvolvimento/CAD). Fix: `EXISTS(direcionamento) OR
-- EXISTS(direcionamento_lojas)` nas duas — igual ao trigger já faz. Corpo restante
-- byte-idêntico (diff-validado via pg_get_functiondef antes/depois). Mesma assinatura de cada
-- função → CREATE OR REPLACE preserva o ACL existente (nenhuma das duas tinha REVOKE aplicado
-- antes — conferido via proacl/has_function_privilege — então não há REVOKE a reassert aqui).
BEGIN;

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
    'direcionamento', EXISTS (SELECT 1 FROM public.direcionamento WHERE cad_id = v_cad)
      OR EXISTS (SELECT 1 FROM public.direcionamento_lojas dl WHERE dl.cad_id = v_cad),
    -- Fonte única (tabela lancamentos aposentada): modelos.lancado.
    'lancamentos', COALESCE((SELECT lancado FROM public.modelos WHERE id = _modelo_id), false)
  );
END;
$function$;

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
    IF EXISTS (SELECT 1 FROM public.direcionamento        WHERE cad_id = v_cad)
       OR EXISTS (SELECT 1 FROM public.direcionamento_lojas dl WHERE dl.cad_id = v_cad) THEN v_etapas := array_append(v_etapas, 'direcionamento'); END IF;
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
SELECT pg_notify('pgrst', 'reload schema');
