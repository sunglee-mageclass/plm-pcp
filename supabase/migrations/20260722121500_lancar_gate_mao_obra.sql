-- lancar_modelo: o gate de "serviços aprovados" (por-bloco) vira "mão de obra aprovada"
-- por modelo (modelos.custo_terceirizados_aprovado). Lançar exige CQ liberado E mão de
-- obra aprovada E data de lançamento.
CREATE OR REPLACE FUNCTION public.lancar_modelo(_modelo_id uuid, _data_lancamento date, _send boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cad uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = _modelo_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;

  IF _send THEN
    SELECT id INTO v_cad FROM public.cad WHERE modelo_id = _modelo_id LIMIT 1;
    IF v_cad IS NULL OR NOT public._cq_liberado(v_cad) THEN
      RAISE EXCEPTION 'Confirme o Controle de Qualidade antes de lançar.' USING ERRCODE='42501';
    END IF;
    IF NOT COALESCE((SELECT custo_terceirizados_aprovado FROM public.modelos
                      WHERE id = _modelo_id AND tenant_id = v_tenant), false) THEN
      RAISE EXCEPTION 'Aprove a mão de obra antes de lançar.' USING ERRCODE='42501';
    END IF;
    IF _data_lancamento IS NULL THEN
      RAISE EXCEPTION 'Informe a Data de Lançamento.' USING ERRCODE='42501';
    END IF;

    UPDATE public.modelos
       SET lancado = true,
           data_lancamento = _data_lancamento,
           revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) - 'lancamentos'
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  ELSE
    UPDATE public.modelos
       SET lancado = false
     WHERE id = _modelo_id AND tenant_id = v_tenant;
  END IF;
END;
$function$
