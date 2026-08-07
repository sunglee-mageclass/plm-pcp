-- 20260807120000_salvar_cq_rev_base.sql
-- Colab CQ (spec 2026-08-07), Task 3: _rev_base DOS DOIS LADOS ({cq, fonte}) em salvar_cq.
-- O core ganha o 6º param _rev_base + um bloco de rev-check (cq e fonte) inserido logo após
-- `v_fonte := _resolver_fonte_confeccao(...)` e ANTES do bloco FONTE ÚNICA (grade_detalhe).
-- TODA a lógica atual (Grade Cortada, [C1], cq_variantes, cad_grades, guard Σ) permanece
-- VERBATIM — o corpo abaixo foi gerado a partir do pg_get_functiondef VIVO do core.
-- Assinatura NOVA (6-arg) = função NOVA → REVOKE dos TRÊS no core (invariante #9) e, no
-- wrapper (DROP reseta ACL), REPOR o REVOKE FROM PUBLIC,anon + GRANT authenticated (lição T2).
-- Envolvido em BEGIN/COMMIT (há DROP). Idempotente (CREATE OR REPLACE + DROP IF EXISTS).
BEGIN;

DROP FUNCTION IF EXISTS public.salvar_cq(uuid, jsonb, jsonb, jsonb, boolean);
DROP FUNCTION IF EXISTS public._salvar_cq_core(uuid, jsonb, jsonb, jsonb, boolean);

CREATE OR REPLACE FUNCTION public._salvar_cq_core(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cq_id uuid; v_status_atual text; v_status text; v_confirmado_at timestamptz;
  v_total_real int; r jsonb;
  v_fonte uuid; v_gd jsonb; v_vid uuid; v_tam text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  v_fonte := public._resolver_fonte_confeccao(_cad_id);

  -- Trava otimista DOS DOIS LADOS (spec 2026-08-07): _rev_base = { cq: rev, fonte: rev|null }.
  -- cq: confere controle_qualidade.rev — só se a linha já existe (CQ novo não trava). fonte:
  -- confere producao_terceirizados.rev do bloco-fonte — só se há fonte E base.fonte não-nula.
  -- _rev_base null/ausente = bypass (compat + super_admin). Lê FOR UPDATE (segura o lock).
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev_cq int; v_rev_ft int;
    BEGIN
      IF (_rev_base ? 'cq') AND (_rev_base->>'cq') IS NOT NULL THEN
        SELECT rev INTO v_rev_cq FROM public.controle_qualidade
          WHERE cad_id = _cad_id AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
          FOR UPDATE;
        IF v_rev_cq IS NOT NULL AND v_rev_cq IS DISTINCT FROM (_rev_base->>'cq')::int THEN
          RAISE EXCEPTION 'conflito_versao: o Controle de Qualidade foi salvo por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END IF;
      IF v_fonte IS NOT NULL AND (_rev_base ? 'fonte') AND (_rev_base->>'fonte') IS NOT NULL THEN
        SELECT rev INTO v_rev_ft FROM public.producao_terceirizados WHERE id = v_fonte FOR UPDATE;
        IF v_rev_ft IS DISTINCT FROM (_rev_base->>'fonte')::int THEN
          RAISE EXCEPTION 'conflito_versao: a grade do serviço-fonte foi salva por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END IF;
    END;
  END IF;

  -- FONTE ÚNICA (cedo, ANTES do [C1]): se há bloco-fonte, mescla recebida/defeito do payload no
  -- grade_detalhe do bloco (traduzindo variante_numero→variante_tecido_id via ordem). PRESERVA
  -- enviada/cortada. Rola quantidade_enviada/recebida/defeito = Σ das células (F2: enviada mantém o
  -- auto_status coerente). Feito antes do [C1] para que guard e Grade Real usem a MESMA fonte; se o
  -- [C1] abortar, este UPDATE é revertido na mesma txn.
  IF v_fonte IS NOT NULL THEN
    SELECT COALESCE(grade_detalhe, '{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = v_fonte;
    FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb))
             WHERE value->>'etapa' IN ('recebimento','defeito') LOOP
      SELECT ctv.variante_tecido_id INTO v_vid
        FROM public.cad_tecidos ct
        JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
       WHERE ct.cad_id = _cad_id AND ct.tipo='tecido' AND ct.numero=1 AND ctv.ordem = (r->>'variante_numero')::int
       LIMIT 1;
      IF v_vid IS NULL THEN CONTINUE; END IF;
      -- GUARD: jsonb_set NÃO cria chaves intermediárias — garante o objeto da variante antes do
      -- set aninhado, senão o set vira no-op silencioso quando a variante ainda não existe no jsonb.
      IF NOT (v_gd ? v_vid::text) THEN
        v_gd := v_gd || jsonb_build_object(v_vid::text, '{}'::jsonb);
      END IF;
      FOR v_tam IN SELECT jsonb_object_keys(COALESCE(r->'grades','{}'::jsonb)) LOOP
        v_gd := jsonb_set(v_gd, ARRAY[v_vid::text, v_tam],
          COALESCE(v_gd->v_vid::text->v_tam, '{}'::jsonb)
          || jsonb_build_object(CASE WHEN r->>'etapa'='recebimento' THEN 'recebida' ELSE 'defeito' END,
                                COALESCE((r->'grades'->>v_tam)::int,0)), true);
      END LOOP;
    END LOOP;
    UPDATE public.producao_terceirizados SET grade_detalhe = v_gd,
      quantidade_enviada  = (SELECT COALESCE(SUM((cell->>'enviada')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_recebida = (SELECT COALESCE(SUM((cell->>'recebida')::int),0) FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_defeito  = (SELECT COALESCE(SUM((cell->>'defeito')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell)
    WHERE id = v_fonte;
  END IF;

  -- [C1] confirmar exige ter contado ao menos 1 peça (Σ da Grade Real > 0). COM fonte: Σ max(0,
  -- recebida−defeito) sobre as células do grade_detalhe (a MESMA fonte da Grade Real gravada).
  -- SEM fonte: Σ do _reais do cliente (comportamento atual).
  IF _confirmar THEN
    IF v_fonte IS NOT NULL THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE((cell->>'recebida')::int,0) - COALESCE((cell->>'defeito')::int,0))), 0)
        INTO v_total_real FROM jsonb_path_query(COALESCE(v_gd,'{}'::jsonb),'$.*.*') cell;
    ELSE
      SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
        INTO v_total_real FROM jsonb_array_elements(COALESCE(_reais,'[]'::jsonb)) e;
    END IF;
    IF v_total_real = 0 THEN
      RAISE EXCEPTION 'Conte ao menos uma peça no Recebimento antes de confirmar o Controle de Qualidade.';
    END IF;
  END IF;

  SELECT id, status INTO v_cq_id, v_status_atual FROM public.controle_qualidade WHERE cad_id = _cad_id;

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
      _cad_id, v_tenant, _cq->>'observacoes_cq',
      NULLIF(_cq->>'pecas_incompletas','')::int, NULLIF(_cq->>'pecas_faltantes','')::int, NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      NULLIF(_cq->>'data_conserto_enviado','')::date, NULLIF(_cq->>'data_conserto_prevista','')::date, NULLIF(_cq->>'data_conserto_entregue','')::date,
      NULLIF(_cq->>'data_lavagem_enviado','')::date, NULLIF(_cq->>'data_lavagem_entregue','')::date,
      NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date, NULLIF(_cq->>'data_recebimento_prevista','')::date, NULLIF(_cq->>'data_recebimento_entregue','')::date,
      COALESCE(_cq->'fotografado_variantes', '{}'::jsonb), v_status, v_confirmado_at
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

  DELETE FROM public.cq_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      INSERT INTO public.cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id, (r->>'variante_numero')::int, r->>'etapa', COALESCE(r->'grades', '{}'::jsonb),
        (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
        NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  -- Grade Real → cad_grades quando confirmado. COM fonte: deriva do grade_detalhe (recebida−defeito).
  -- SEM fonte: usa _reais do cliente (comportamento atual, verbatim). Ambos preservam grades_planejadas.
  IF v_status = 'confirmado' THEN
    IF v_fonte IS NOT NULL THEN
      PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
    ELSIF jsonb_typeof(_reais) = 'array' THEN
      FOR r IN SELECT value FROM jsonb_array_elements(_reais) LOOP
        INSERT INTO public.cad_grades
          (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
        VALUES (
          _cad_id, (r->>'variante_numero')::int, COALESCE(r->'grades', '{}'::jsonb), COALESCE(r->'grades', '{}'::jsonb),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x)
        )
        ON CONFLICT (cad_id, variante_numero) DO UPDATE
          SET grades_reais = EXCLUDED.grades_reais, grade_total_real = EXCLUDED.grade_total_real;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status', v_status, 'fonte', v_fonte);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_cq(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('producao') THEN RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE='42501'; END IF;
  RETURN public._salvar_cq_core(_cad_id, _cq, _variantes, _reais, _confirmar, _rev_base);
END $function$;

-- ACL (invariante #9): core revogado dos TRÊS (PUBLIC + anon + authenticated herdam de PUBLIC);
-- wrapper com PUBLIC/anon revogados (DROP+CREATE resetou p/ o default) + concedido a authenticated.
REVOKE EXECUTE ON FUNCTION public._salvar_cq_core(uuid, jsonb, jsonb, jsonb, boolean, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_cq(uuid, jsonb, jsonb, jsonb, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_cq(uuid, jsonb, jsonb, jsonb, boolean, jsonb) TO authenticated;

COMMIT;
