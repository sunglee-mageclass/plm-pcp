-- CQ Pós — espelhar as guardas do Pré (audit de saúde jul/2026, invariante #6/[Σ]/C1).
-- ANTES: _salvar_cq_pos_core confiava no `grade_total` escalar do CLIENTE e deixava confirmar
-- com Σ=0 (sem contar peça). O Pré (_salvar_cq_core) já: [C1] bloqueia confirmar com Σ da grade
-- real = 0, e [Σ] DERIVA grade_total no servidor da soma do mapa `grades`. Este fix traz a mesma
-- disciplina p/ o Pós (alimenta custo/relatórios). Idempotente p/ o front (CqPosView já soma
-- grade_total do mapa) — só remove a confiança no escalar do cliente.

CREATE OR REPLACE FUNCTION public._salvar_cq_pos_core(_cad_id uuid, _cq_pos jsonb, _itens jsonb, _confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cq_id uuid; v_status_atual text; v_status_pre text;
  v_status text; v_confirmado_at timestamptz; v_total_pos int; r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  SELECT id, status_pos, status INTO v_cq_id, v_status_atual, v_status_pre
  FROM public.controle_qualidade WHERE cad_id = _cad_id;

  IF _confirmar AND COALESCE(v_status_pre,'') <> 'confirmado' THEN
    RAISE EXCEPTION 'Confirme o CQ (Pré) deste modelo antes de confirmar o CQ Pós.';
  END IF;

  -- [C1] confirmar exige ter contado ao menos 1 peça no Pós (Σ dos mapas `grades` > 0).
  IF _confirmar THEN
    SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
      INTO v_total_pos FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e;
    IF v_total_pos = 0 THEN
      RAISE EXCEPTION 'Conte ao menos uma peça no CQ Pós (acabamento) antes de confirmar.';
    END IF;
  END IF;

  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  IF v_cq_id IS NULL THEN
    INSERT INTO public.controle_qualidade
      (cad_id, tenant_id, status_pos, confirmado_pos_at, observacoes_cq_pos, fotografado_variantes_pos)
    VALUES (_cad_id, v_tenant, v_status, v_confirmado_at,
            _cq_pos->>'observacoes_cq_pos', COALESCE(_cq_pos->'fotografado_variantes_pos','{}'::jsonb))
    RETURNING id INTO v_cq_id;
  ELSE
    UPDATE public.controle_qualidade SET
      status_pos = v_status,
      confirmado_pos_at = CASE WHEN v_status = 'confirmado' THEN COALESCE(confirmado_pos_at, now()) ELSE NULL END,
      observacoes_cq_pos = _cq_pos->>'observacoes_cq_pos',
      fotografado_variantes_pos = COALESCE(_cq_pos->'fotografado_variantes_pos','{}'::jsonb)
    WHERE id = v_cq_id;
  END IF;

  DELETE FROM public.cq_pos_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_itens) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_itens) LOOP
      INSERT INTO public.cq_pos_variantes
        (controle_qualidade_id, producao_terceirizado_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id, (r->>'producao_terceirizado_id')::uuid, (r->>'variante_numero')::int, r->>'etapa',
        COALESCE(r->'grades','{}'::jsonb),
        -- [Σ] grade_total DERIVADO no servidor da soma do mapa (não confia no escalar do cliente).
        (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
        NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status_pos', v_status);
END;
$function$;

select pg_notify('pgrst','reload schema');
