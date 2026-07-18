BEGIN;

-- Re-gatea 5 RPCs do fluxo CAD/Explosão: producao → criacao
-- Estas RPCs pertencem ao domínio Estilo & Engenharia (Desenvolvimento/Explosão/CAD)
-- e devem funcionar mesmo com o módulo PCP (producao) desligado.
-- Apenas a linha do gate muda; lógica, grants e _core intocados.

CREATE OR REPLACE FUNCTION public.enviar_modelo_para_cad(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._enviar_modelo_para_cad_core(_modelo_id, _observacoes_tecnicas, _ficha_medida_url);
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_cad_completo(_modelo_id uuid, _tecidos jsonb, _grades jsonb, _aviamentos jsonb, _etiquetas jsonb, _proporcoes jsonb, _observacoes_molde text, _data_previsao_corte date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._salvar_cad_completo_core(_modelo_id, _tecidos, _grades, _aviamentos, _etiquetas, _proporcoes, _observacoes_molde, _data_previsao_corte);
END $function$;

CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._baixar_estoque_tecido_corte_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.reverter_corte_tecido(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._reverter_corte_tecido_core(_cad_id);
END $function$;

CREATE OR REPLACE FUNCTION public.excluir_cad(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_modelo uuid; v_enviado boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id, modelo_id, COALESCE(enviado_corte, false)
    INTO v_tenant, v_modelo, v_enviado FROM public.cad WHERE id = _cad_id;
  IF v_modelo IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF v_enviado THEN
    RAISE EXCEPTION 'Este CAD já foi enviado ao corte (baixou estoque). Reverta o corte antes de excluir.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lancamentos WHERE cad_id = _cad_id) THEN
    RAISE EXCEPTION 'Este CAD tem lançamentos e não pode ser excluído.';
  END IF;
  DELETE FROM public.cad WHERE id = _cad_id;  -- rascunho (sem corte): cascatas internas ok
  UPDATE public.modelos SET enviado_cad = false WHERE id = v_modelo;
END;
$function$;

COMMIT;
