-- CAD: guarda no Excluir + FK do ledger vira NO ACTION (integridade #4).
-- ACHADO: estoque_tecido_baixas.cad_id era ON DELETE CASCADE → "Excluir CAD" apagava o ledger
-- de estoque em SILÊNCIO (recebido fica, baixa some → físico fantasma). O caminho pelo cad_id
-- ficou aberto (o variante_tecido_id já era NO ACTION de propósito). Fecha os dois:
--  (1) FK NO ACTION: deletar um CAD com baixas no ledger passa a FALHAR (defesa contra delete cru);
--  (2) RPC excluir_cad: bloqueia com mensagem clara se o CAD já foi ao corte (reverta antes) ou
--      tem lançamentos; senão apaga o CAD (rascunho) e devolve o modelo ao Desenvolvimento.

ALTER TABLE public.estoque_tecido_baixas DROP CONSTRAINT IF EXISTS estoque_tecido_baixas_cad_id_fkey;
ALTER TABLE public.estoque_tecido_baixas
  ADD CONSTRAINT estoque_tecido_baixas_cad_id_fkey
  FOREIGN KEY (cad_id) REFERENCES public.cad(id) ON DELETE NO ACTION;

CREATE OR REPLACE FUNCTION public.excluir_cad(_cad_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_modelo uuid; v_enviado boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
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

REVOKE EXECUTE ON FUNCTION public.excluir_cad(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.excluir_cad(uuid) TO authenticated;
