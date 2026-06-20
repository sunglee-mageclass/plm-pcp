-- Item 5: Confirmar/Desmarcar/Salvar o CQ eram vários supabase em sequência (sem
-- transação): upsert controle_qualidade + delete/insert cq_variantes + writeGradeReal
-- em loop. Falha no meio -> estado inconsistente (status confirmado sem grade real,
-- ou vice-versa). RPCs transacionais: tudo numa transação.

-- salvar_cq: upsert do CQ + troca cq_variantes + (se confirmar/já confirmado)
-- status=confirmado e grava a Grade Real em cad_grades. Tudo ou nada.
CREATE OR REPLACE FUNCTION public.salvar_cq(
  _cad_id uuid,
  _cq jsonb,
  _variantes jsonb,
  _reais jsonb,
  _confirmar boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_cq_id uuid;
  v_status_atual text;
  v_status text;
  v_confirmado_at timestamptz;
  r jsonb;
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

  SELECT id, status INTO v_cq_id, v_status_atual
  FROM public.controle_qualidade WHERE cad_id = _cad_id;

  -- Status final: confirma se pedido; senão mantém o atual (ou pendente se novo).
  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  IF v_cq_id IS NULL THEN
    INSERT INTO public.controle_qualidade (
      cad_id, tenant_id, observacoes_cq, pecas_incompletas, pecas_faltantes, pecas_sem_etiqueta,
      data_conserto_enviado, data_conserto_prevista, data_conserto_entregue,
      data_lavagem_enviado, data_lavagem_entregue,
      data_recebimento_enviado_oficina, data_recebimento_prevista, data_recebimento_entregue,
      fotografado_variantes, status, confirmado_at
    ) VALUES (
      _cad_id, v_tenant,
      _cq->>'observacoes_cq',
      NULLIF(_cq->>'pecas_incompletas','')::int,
      NULLIF(_cq->>'pecas_faltantes','')::int,
      NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      NULLIF(_cq->>'data_conserto_enviado','')::date,
      NULLIF(_cq->>'data_conserto_prevista','')::date,
      NULLIF(_cq->>'data_conserto_entregue','')::date,
      NULLIF(_cq->>'data_lavagem_enviado','')::date,
      NULLIF(_cq->>'data_lavagem_entregue','')::date,
      NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date,
      NULLIF(_cq->>'data_recebimento_prevista','')::date,
      NULLIF(_cq->>'data_recebimento_entregue','')::date,
      COALESCE(_cq->'fotografado_variantes', '{}'::jsonb),
      v_status, v_confirmado_at
    ) RETURNING id INTO v_cq_id;
  ELSE
    UPDATE public.controle_qualidade SET
      observacoes_cq = _cq->>'observacoes_cq',
      pecas_incompletas = NULLIF(_cq->>'pecas_incompletas','')::int,
      pecas_faltantes = NULLIF(_cq->>'pecas_faltantes','')::int,
      pecas_sem_etiqueta = NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      data_conserto_enviado = NULLIF(_cq->>'data_conserto_enviado','')::date,
      data_conserto_prevista = NULLIF(_cq->>'data_conserto_prevista','')::date,
      data_conserto_entregue = NULLIF(_cq->>'data_conserto_entregue','')::date,
      data_lavagem_enviado = NULLIF(_cq->>'data_lavagem_enviado','')::date,
      data_lavagem_entregue = NULLIF(_cq->>'data_lavagem_entregue','')::date,
      data_recebimento_enviado_oficina = NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date,
      data_recebimento_prevista = NULLIF(_cq->>'data_recebimento_prevista','')::date,
      data_recebimento_entregue = NULLIF(_cq->>'data_recebimento_entregue','')::date,
      fotografado_variantes = COALESCE(_cq->'fotografado_variantes', '{}'::jsonb),
      status = v_status,
      confirmado_at = CASE WHEN v_status = 'confirmado' THEN COALESCE(confirmado_at, now()) ELSE NULL END
    WHERE id = v_cq_id;
  END IF;

  -- Troca cq_variantes (tudo na mesma transação).
  DELETE FROM public.cq_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      INSERT INTO public.cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id,
        (r->>'variante_numero')::int,
        r->>'etapa',
        COALESCE(r->'grades', '{}'::jsonb),
        COALESCE((r->>'grade_total')::int, 0),
        NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  -- Grade Real em cad_grades só quando confirmado.
  IF v_status = 'confirmado' AND jsonb_typeof(_reais) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_reais) LOOP
      INSERT INTO public.cad_grades
        (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
      VALUES (
        _cad_id,
        (r->>'variante_numero')::int,
        COALESCE(r->'grades', '{}'::jsonb),
        COALESCE(r->'grades', '{}'::jsonb),
        COALESCE((r->>'grade_total')::int, 0),
        COALESCE((r->>'grade_total')::int, 0)
      )
      ON CONFLICT (cad_id, variante_numero) DO UPDATE
        SET grades_reais = EXCLUDED.grades_reais,
            grade_total_real = EXCLUDED.grade_total_real;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status', v_status);
END;
$function$;

-- desmarcar_cq: status=pendente + reverte a Grade Real para a planejada. Atômico.
CREATE OR REPLACE FUNCTION public.desmarcar_cq(_cad_id uuid)
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

  RETURN jsonb_build_object('ok', true, 'status', 'pendente');
END;
$function$;
