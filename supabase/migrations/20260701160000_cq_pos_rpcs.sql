-- Fase 3 — RPCs do CQ Pós (wrapper checa módulo producao; _core faz o trabalho).
-- Diferença p/ o CQ Pré: NÃO grava cad_grades (a grade real do direcionamento é a do Pré).

CREATE OR REPLACE FUNCTION public._salvar_cq_pos_core(
  _cad_id uuid,
  _cq_pos jsonb,
  _itens jsonb,
  _confirmar boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_cq_id uuid;
  v_status_atual text;
  v_status text;
  v_confirmado_at timestamptz;
  r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  SELECT id, status_pos INTO v_cq_id, v_status_atual
  FROM public.controle_qualidade WHERE cad_id = _cad_id;

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

  -- Troca cq_pos_variantes (tudo na mesma transação).
  DELETE FROM public.cq_pos_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_itens) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_itens) LOOP
      INSERT INTO public.cq_pos_variantes
        (controle_qualidade_id, producao_terceirizado_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id,
        (r->>'producao_terceirizado_id')::uuid,
        (r->>'variante_numero')::int,
        r->>'etapa',
        COALESCE(r->'grades','{}'::jsonb),
        COALESCE((r->>'grade_total')::int, 0),
        NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status_pos', v_status);
END;
$function$;

CREATE OR REPLACE FUNCTION public._desmarcar_cq_pos_core(_cad_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  UPDATE public.controle_qualidade
     SET status_pos = 'pendente', confirmado_pos_at = NULL
   WHERE cad_id = _cad_id;

  -- Desmarcar o pós invalida o lançamento (direcionamento exige Pré E Pós).
  UPDATE public.lancamentos SET verificado = false WHERE cad_id = _cad_id;

  RETURN jsonb_build_object('ok', true, 'status_pos', 'pendente');
END;
$function$;

-- Wrappers (gate de módulo) + grants.
CREATE OR REPLACE FUNCTION public.salvar_cq_pos(_cad_id uuid, _cq_pos jsonb, _itens jsonb, _confirmar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._salvar_cq_pos_core(_cad_id, _cq_pos, _itens, _confirmar);
END $function$;

CREATE OR REPLACE FUNCTION public.desmarcar_cq_pos(_cad_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._desmarcar_cq_pos_core(_cad_id);
END $function$;

REVOKE ALL ON FUNCTION public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._desmarcar_cq_pos_core(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_cq_pos(uuid,jsonb,jsonb,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.desmarcar_cq_pos(uuid) TO authenticated;
