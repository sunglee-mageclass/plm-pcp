-- Bug 2 (reverter deixa lixo): _reverter_corte_tecido_core só zerava enviado_corte, deixando
-- serviços/CQ/oficina/direcionamento órfãos + revisao_pendente stale (#Erro fantasma que
-- ressurge ao reenviar). "Voltar uma etapa" = volta REALMENTE pra Explosão: apaga todo o
-- downstream do corte e limpa as flags. Financeiro: bloqueia se houver conta a pagar de
-- serviço JÁ PAGA (não desfaz dinheiro quitado); parcelas NÃO pagas cascateiam com o serviço.
BEGIN;

CREATE OR REPLACE FUNCTION public._reverter_corte_tecido_core(_cad_id uuid)
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

  -- Guarda financeira: não desfaz serviço com conta a pagar JÁ PAGA.
  IF EXISTS (
    SELECT 1 FROM public.parcelas_servico ps
    JOIN public.producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    WHERE pt.cad_id = _cad_id AND ps.status = 'pago'
  ) THEN
    RAISE EXCEPTION 'Não é possível voltar: há conta a pagar de serviço já paga. Cancele o pagamento antes de reverter.' USING ERRCODE='42501';
  END IF;

  -- Apaga o downstream do corte (serviços cascateiam parcelas_servico NÃO pagas;
  -- controle_qualidade cascateia cq_variantes/cq_pos_variantes).
  DELETE FROM public.producao_terceirizados WHERE cad_id = _cad_id;
  DELETE FROM public.producao_oficina       WHERE cad_id = _cad_id;
  DELETE FROM public.controle_qualidade      WHERE cad_id = _cad_id;
  DELETE FROM public.direcionamento          WHERE cad_id = _cad_id;
  DELETE FROM public.estoque_tecido_baixas   WHERE cad_id = _cad_id;

  -- Volta o CAD pro estado pré-corte ANTES de mexer na grade — com direcionamento_status
  -- já 'pendente', o trg_rebaixa_direcionamento_grade não re-acende #Erro no UPDATE de cad_grades.
  UPDATE public.cad
     SET enviado_corte = false,
         status_corte = 'pendente',
         data_enviado_corte = NULL,
         direcionamento_status = 'pendente'
   WHERE id = _cad_id;

  -- A grade REAL vinha do CQ (agora apagado): volta a espelhar a planejada.
  UPDATE public.cad_grades
     SET grades_reais = grades_planejadas,
         grade_total_real = grade_total_planejada
   WHERE cad_id = _cad_id;

  -- Limpa flags de #Erro e "lançado" no modelo POR ÚLTIMO (neutraliza qualquer flag que os
  -- triggers de rebaixa (cad_grades / controle_qualidade) tenham re-acendido nos passos acima).
  UPDATE public.modelos
     SET revisao_pendente = (COALESCE(revisao_pendente, '{}'::jsonb)
                             - 'terceirizados' - 'oficina' - 'cq' - 'direcionamento' - 'lancamentos'),
         lancado = false
   WHERE id = v_modelo;
END;
$function$;

-- Invariante #9: _core revogado dos TRÊS (o wrapper reverter_corte_tecido é quem gateia módulo).
REVOKE EXECUTE ON FUNCTION public._reverter_corte_tecido_core(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
