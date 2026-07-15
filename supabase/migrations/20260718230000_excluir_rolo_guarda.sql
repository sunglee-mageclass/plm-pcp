-- HIGH (audit de saúde jul/2026): excluir rolo apagava o LEDGER de estoque em silêncio.
-- BUG: RolosList.excluir fazia `supabase.from('ocs_tecido').delete().eq('id', id)` CRU. A
-- cadeia de FK ocs_tecido → ocs_tecido_itens → estoque_tecido_baixas é toda ON DELETE CASCADE,
-- então excluir um rolo já consumido no corte (baixa origem='fifo'/'ajuste' no item do rolo)
-- ou vinculado no Desenvolvimento (modelo_tecido_oc_links) apagava o ledger sem aviso —
-- exatamente o anti-padrão que o invariante #4 corrige em excluir_tecido/excluir_variante_tecido.
-- FIX: rotear a exclusão por uma RPC com o MESMO guard que cancelar/ajustar/trocar já usam
-- (_rolo_em_uso: EXISTS baixa no item do rolo OU vínculo de Dev). Para um rolo NÃO em uso a
-- exclusão é segura: a baixa 'separacao_rolo' referencia o item de ORIGEM (não o item do rolo),
-- então o CASCADE via rolo_id devolve a metragem à OC de origem — o comportamento que o
-- AlertDialog do front já promete ("a metragem volta para o estoque dessa OC").

CREATE OR REPLACE FUNCTION public._excluir_rolo_core(_rolo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant
  FROM public.ocs_tecido WHERE id = _rolo_id AND is_rolo = true;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Rolo não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este rolo';
  END IF;
  IF public._rolo_em_uso(_rolo_id) THEN
    RAISE EXCEPTION 'Rolo já em uso (consumido no corte ou selecionado em Desenvolvimento) — desfaça o uso antes de excluir.';
  END IF;

  -- Seguro: o item do rolo não tem baixa nem vínculo (garantido por _rolo_em_uso acima). A
  -- baixa 'separacao_rolo' (se houver) fica no item de ORIGEM e é removida pelo CASCADE via
  -- rolo_id, devolvendo a metragem à OC de origem — igual ao _cancelar_rolo_core.
  DELETE FROM public.ocs_tecido WHERE id = _rolo_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._excluir_rolo_core(uuid) FROM public, anon, authenticated;

-- Wrapper público: gate de módulo (igual cancelar/reabrir/ajustar/trocar_rolo).
CREATE OR REPLACE FUNCTION public.excluir_rolo(_rolo_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._excluir_rolo_core(_rolo_id);
END $function$;

select pg_notify('pgrst','reload schema');
