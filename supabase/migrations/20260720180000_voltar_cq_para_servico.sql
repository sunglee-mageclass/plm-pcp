-- "Voltar uma etapa" no CQ deve ir só até SERVIÇOS (uma etapa), não até a Explosão.
-- O reverter_corte_tecido (que a tela do CQ usava) volta até a Explosão (desfaz o corte) —
-- correto para o botão do SERVIÇOS, errado para o do CQ. Esta RPC volta o modelo do CQ
-- para Serviços: reabre os serviços pré-costura (desfaz o recebimento → deixam de estar
-- "finalizados" → saem do CQ) e apaga o CQ. NÃO mexe no corte, NÃO apaga serviço/conta.
BEGIN;

CREATE OR REPLACE FUNCTION public._voltar_cq_para_servico_core(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_modelo uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id, modelo_id INTO v_tenant, v_modelo FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  -- Desfaz o CQ (cascateia cq_variantes/cq_pos_variantes) e o direcionamento (defensivo:
  -- direcionamento é etapa posterior; um modelo em CQ normalmente não tem, mas garante limpeza).
  DELETE FROM public.controle_qualidade WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento     WHERE cad_id = _cad_id;

  -- Reabre os serviços PRÉ-costura: desfaz o recebimento (data_entregue/qtds) → deixam de
  -- estar "finalizados" → o modelo sai do CQ e volta pra Serviços. O trigger
  -- auto_status_prod_terc_trg reajusta o status. NÃO apaga o serviço nem a conta a pagar,
  -- e NÃO mexe no corte (continua em produção).
  UPDATE public.producao_terceirizados pt
     SET data_entregue = NULL,
         quantidade_recebida = 0,
         quantidade_defeito = 0
   WHERE pt.cad_id = _cad_id
     AND COALESCE((SELECT ct.etapa FROM public.categorias_terceirizado ct
                    WHERE ct.id = pt.categoria_terceirizado_id), 'ate_costura') = 'ate_costura';

  -- Reseta direcionamento_status e limpa flags de #Erro (por último — neutraliza o que os
  -- triggers de rebaixa (CQ) possam ter re-acendido nos passos acima).
  UPDATE public.cad SET direcionamento_status = 'pendente' WHERE id = _cad_id;
  UPDATE public.modelos
     SET revisao_pendente = (COALESCE(revisao_pendente, '{}'::jsonb) - 'cq' - 'direcionamento' - 'lancamentos'),
         lancado = false
   WHERE id = v_modelo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.voltar_cq_para_servico(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501';
  END IF;
  PERFORM public._voltar_cq_para_servico_core(_cad_id);
END $function$;

REVOKE EXECUTE ON FUNCTION public._voltar_cq_para_servico_core(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
