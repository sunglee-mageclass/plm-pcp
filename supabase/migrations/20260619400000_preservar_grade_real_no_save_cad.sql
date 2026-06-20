-- P0-1: salvar_cad_completo apagava a Grade Real do CQ.
-- O bloco de cad_grades re-inseria grades_reais = grades_planejadas e
-- grade_total_real = grade_total INCONDICIONALMENTE, então qualquer save do CAD
-- depois do CQ confirmado zerava a grade real (recebimento - defeito) de volta
-- para a planejada, sem desmarcar o CQ e sem aviso.
--
-- Correção: quando o CQ daquele CAD está 'confirmado', preserva-se grades_reais
-- e grade_total_real existentes (snapshot tirado ANTES do DELETE). Antes do CQ,
-- o comportamento continua o mesmo (real = planejada).

CREATE OR REPLACE FUNCTION public.salvar_cad_completo(_modelo_id uuid, _tecidos jsonb, _grades jsonb, _aviamentos jsonb, _etiquetas jsonb, _proporcoes jsonb, _observacoes_molde text, _data_previsao_corte date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_cad_id uuid;
  v_new_tid uuid;
  t jsonb;
  v jsonb;
  g jsonb;
  a jsonb;
  e jsonb;
  v_cq_confirmado boolean := false;
  v_reais jsonb := '{}'::jsonb;
  v_key text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- CAD existente ou cria (trigger set_tenant_id_trg preenche tenant_id).
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id;
  IF v_cad_id IS NULL THEN
    INSERT INTO public.cad (modelo_id, status_corte)
    VALUES (_modelo_id, 'pendente')
    RETURNING id INTO v_cad_id;
  END IF;

  -- Se o CQ deste CAD está confirmado, tira o snapshot da grade REAL ANTES de
  -- apagar cad_grades, para preservá-la no re-insert (não voltar para a planejada).
  SELECT EXISTS(SELECT 1 FROM public.controle_qualidade q
                WHERE q.cad_id = v_cad_id AND q.status = 'confirmado')
    INTO v_cq_confirmado;
  IF v_cq_confirmado THEN
    SELECT COALESCE(jsonb_object_agg(
             cg.variante_numero::text,
             jsonb_build_object('gr', cg.grades_reais, 'gt', cg.grade_total_real)
           ), '{}'::jsonb)
      INTO v_reais
      FROM public.cad_grades cg
     WHERE cg.cad_id = v_cad_id;
  END IF;

  -- Limpa o que será re-inserido (tudo dentro da mesma transação).
  DELETE FROM public.cad_tecidos WHERE cad_id = v_cad_id;          -- cascateia variantes
  DELETE FROM public.cad_grades WHERE cad_id = v_cad_id;
  DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id;
  DELETE FROM public.cad_aviamentos WHERE cad_id = v_cad_id;
  DELETE FROM public.cad_etiquetas WHERE cad_id = v_cad_id;

  -- Tecidos + variantes
  IF jsonb_typeof(_tecidos) = 'array' THEN
    FOR t IN SELECT value FROM jsonb_array_elements(COALESCE(_tecidos, '[]'::jsonb)) LOOP
      INSERT INTO public.cad_tecidos
        (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
      VALUES
        (v_cad_id,
         (t->>'artigo_id')::uuid,
         (t->>'numero')::int,
         COALESCE(t->>'tipo', 'tecido'),
         COALESCE((t->>'consumo_cad')::numeric, 0),
         COALESCE((t->>'loss_percent_cad')::numeric, 0),
         COALESCE((t->>'custo_cad')::numeric, 0),
         COALESCE((t->>'tamanho_folha')::numeric, 0))
      RETURNING id INTO v_new_tid;

      IF jsonb_typeof(t->'variantes') = 'array' THEN
        FOR v IN SELECT value FROM jsonb_array_elements(t->'variantes') LOOP
          INSERT INTO public.cad_tecido_variantes
            (cad_tecido_id, variante_tecido_id, ordem, multiplicador,
             quantidade_folhas, metragem_planejada, metragem_enviada)
          VALUES
            (v_new_tid,
             (v->>'variante_tecido_id')::uuid,
             (v->>'ordem')::int,
             COALESCE(NULLIF(v->>'multiplicador','')::numeric, 1),
             COALESCE((v->>'quantidade_folhas')::numeric, 0),
             COALESCE((v->>'metragem_planejada')::numeric, 0),
             COALESCE((v->>'metragem_enviada')::numeric, 0));
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- Proporções no modelo (compartilhadas com o Desenvolvimento)
  UPDATE public.modelos SET proporcoes = COALESCE(_proporcoes, '{}'::jsonb) WHERE id = _modelo_id;

  -- Grade ÚNICA: modelo_grades (fonte) + espelho em cad_grades.
  -- A grade REAL é preservada quando o CQ está confirmado (v_reais); caso
  -- contrário, real = planejada (comportamento original).
  -- O front já envia só as grades com algum valor.
  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(COALESCE(_grades, '[]'::jsonb)) LOOP
      v_key := g->>'variante_numero';

      INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
      VALUES (_modelo_id,
              v_key::int,
              COALESCE(g->'grades', '{}'::jsonb),
              COALESCE((g->>'grade_total')::int, 0));

      INSERT INTO public.cad_grades
        (cad_id, variante_numero, grades_planejadas, grades_reais,
         grade_total_planejada, grade_total_real)
      VALUES (v_cad_id,
              v_key::int,
              COALESCE(g->'grades', '{}'::jsonb),
              CASE WHEN v_cq_confirmado AND v_reais ? v_key
                   THEN v_reais->v_key->'gr'
                   ELSE COALESCE(g->'grades', '{}'::jsonb) END,
              COALESCE((g->>'grade_total')::int, 0),
              CASE WHEN v_cq_confirmado AND v_reais ? v_key
                   THEN COALESCE((v_reais->v_key->>'gt')::int, 0)
                   ELSE COALESCE((g->>'grade_total')::int, 0) END);
    END LOOP;
  END IF;

  -- Aviamentos
  IF jsonb_typeof(_aviamentos) = 'array' THEN
    FOR a IN SELECT value FROM jsonb_array_elements(COALESCE(_aviamentos, '[]'::jsonb)) LOOP
      INSERT INTO public.cad_aviamentos
        (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar)
      VALUES
        (v_cad_id,
         (a->>'aviamento_id')::uuid,
         (a->>'numero')::int,
         COALESCE((a->>'consumo')::numeric, 0),
         COALESCE((a->>'quantidade_enviar')::numeric, 0),
         COALESCE((a->>'quantidade_separar')::numeric, 0));
    END LOOP;
  END IF;

  -- Etiquetas/TAG (quantidade_planejada já vem calculada do front)
  IF jsonb_typeof(_etiquetas) = 'array' THEN
    FOR e IN SELECT value FROM jsonb_array_elements(COALESCE(_etiquetas, '[]'::jsonb)) LOOP
      INSERT INTO public.cad_etiquetas
        (cad_id, etiqueta_id, consumo, quantidade_planejada, quantidade_enviar)
      VALUES
        (v_cad_id,
         (e->>'etiqueta_id')::uuid,
         COALESCE((e->>'consumo')::numeric, 0),
         COALESCE((e->>'quantidade_planejada')::numeric, 0),
         COALESCE((e->>'quantidade_enviar')::numeric, 0));
    END LOOP;
  END IF;

  -- Cabeçalho do CAD
  UPDATE public.cad
     SET observacoes_molde = _observacoes_molde,
         data_previsao_corte = COALESCE(_data_previsao_corte, data_previsao_corte)
   WHERE id = v_cad_id;

  -- Sincroniza consumo e %loss do CAD de volta para o Desenvolvimento (BOM), por
  -- tipo/número, para reserva/consumo por OC/previsto refletirem o ajuste do CAD.
  UPDATE public.modelo_tecidos mt
     SET consumo = ct.consumo_cad,
         loss_percent = ct.loss_percent_cad
    FROM public.cad_tecidos ct
   WHERE ct.cad_id = v_cad_id
     AND mt.modelo_id = _modelo_id
     AND mt.tipo = ct.tipo
     AND mt.numero = ct.numero;

  RETURN v_cad_id;
END;
$function$;
