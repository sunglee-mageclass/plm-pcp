-- Fix 4: "Lançar" era um UPDATE direto em modelos.lancado no front, sem gate no servidor —
-- dava pra lançar um modelo sem CQ liberado via API (corrompe poder de venda/custo realizado).
-- RPC de negócio que ENFORÇA no servidor: CQ liberado (_cq_liberado), valor dos serviços
-- externos aprovado, e Data de Lançamento. Também limpa o #Erro de 'lancamentos' ao lançar.
BEGIN;

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
    IF EXISTS (
      SELECT 1 FROM public.producao_terceirizados
       WHERE cad_id = v_cad AND COALESCE(interno,false) = false AND COALESCE(aprovado,false) = false
    ) THEN
      RAISE EXCEPTION 'Aprove o valor dos serviços antes de lançar.' USING ERRCODE='42501';
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
$function$;

REVOKE EXECUTE ON FUNCTION public.lancar_modelo(uuid, date, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lancar_modelo(uuid, date, boolean) TO authenticated;

COMMIT;
