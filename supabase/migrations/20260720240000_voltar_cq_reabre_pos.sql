-- Fix 3: _voltar_cq_para_servico_core reabria só os serviços PRÉ-costura (ate_costura). Se havia
-- serviço PÓS-costura "finalizado", ele ficava finalizado com status_pos='pendente' (o CQ é
-- apagado) → estado inconsistente. Voltar do CQ para Serviços significa refazer os serviços;
-- reabre TODOS os serviços ativos (pré E pós) desfazendo o recebimento.
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

  -- Desfaz o CQ (cascateia cq_variantes/cq_pos_variantes) e o direcionamento (defensivo).
  DELETE FROM public.controle_qualidade WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento     WHERE cad_id = _cad_id;

  -- Reabre TODOS os serviços ativos (pré E pós-costura): desfaz o recebimento → deixam de estar
  -- "finalizados" → o modelo sai do CQ e volta pra Serviços. O trigger auto_status_prod_terc_trg
  -- reajusta o status. NÃO apaga o serviço nem a conta a pagar, e NÃO mexe no corte.
  UPDATE public.producao_terceirizados
     SET data_entregue = NULL,
         quantidade_recebida = 0,
         quantidade_defeito = 0
   WHERE cad_id = _cad_id
     AND COALESCE(ativo, true) = true;

  -- Reseta direcionamento_status e limpa flags de #Erro (por último).
  UPDATE public.cad SET direcionamento_status = 'pendente' WHERE id = _cad_id;
  UPDATE public.modelos
     SET revisao_pendente = (COALESCE(revisao_pendente, '{}'::jsonb) - 'cq' - 'direcionamento' - 'lancamentos'),
         lancado = false
   WHERE id = v_modelo;
END;
$function$;

COMMIT;
