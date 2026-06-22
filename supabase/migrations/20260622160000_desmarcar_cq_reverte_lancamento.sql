-- Item 14 (Fase 2) — Part A: "lançado fantasma". lancamentos.verificado nunca
-- voltava a false; um modelo desmarcado no CQ continuava "lançado". Ao desmarcar
-- o CQ, o lançamento deixa de ser válido → verificado=false.

CREATE OR REPLACE FUNCTION public._desmarcar_cq_core(_cad_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  UPDATE public.controle_qualidade
     SET status = 'pendente', confirmado_at = NULL
   WHERE cad_id = _cad_id;

  UPDATE public.cad_grades
     SET grades_reais = grades_planejadas,
         grade_total_real = grade_total_planejada
   WHERE cad_id = _cad_id;

  -- CQ deixou de estar confirmado → o lançamento não é mais válido.
  UPDATE public.lancamentos
     SET verificado = false
   WHERE cad_id = _cad_id;

  RETURN jsonb_build_object('ok', true, 'status', 'pendente');
END;
$function$;
