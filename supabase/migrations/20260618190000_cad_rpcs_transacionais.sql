-- ============================================================================
-- Blindagem dos saves do CAD em RPCs transacionais (atômicas).
--
-- Problema (diagnóstico read-only): os saves do CAD e do "Enviar para CAD"
-- faziam delete-then-insert em várias tabelas SEM transação no front. Uma falha
-- parcial (rede, RLS, constraint) deixava o CAD/Desenvolvimento com a grade ou
-- os tecidos apagados e não re-inseridos -> PERDA DE DADOS. Além disso, o
-- "Enviar para CAD" não era idempotente: re-clique gerava um SEGUNDO `cad` para
-- o mesmo modelo (sem unique em cad.modelo_id).
--
-- Solução:
--   1) UNIQUE(cad.modelo_id)  -> backstop de idempotência (1 CAD por modelo).
--   2) salvar_cad_completo()  -> persiste TODO o CAD numa única função plpgsql
--      (logo, numa única transação: qualquer erro faz ROLLBACK de tudo).
--   3) enviar_modelo_para_cad() -> cria o CAD e copia o BOM do Desenvolvimento
--      atomicamente; recusa se o modelo já tem CAD.
--
-- Toda a ARITMÉTICA continua no front (números idênticos aos de hoje); estas
-- funções só recebem os payloads já calculados e fazem a persistência atômica.
-- Mesmo padrão do salvar_modelo_bom: SECURITY DEFINER, search_path=public,
-- valida tenant pelo modelo. As tabelas-filhas do CAD não têm tenant_id (o
-- isolamento vem por cad_id -> cad.tenant_id, preenchido pelo trigger).
-- ============================================================================

-- 1) Idempotência: no máximo um CAD por modelo. (NULL permite múltiplos no PG,
--    mas modelo_id de CAD nunca é nulo na prática.)
ALTER TABLE public.cad DROP CONSTRAINT IF EXISTS cad_modelo_id_key;
ALTER TABLE public.cad ADD CONSTRAINT cad_modelo_id_key UNIQUE (modelo_id);

-- ----------------------------------------------------------------------------
-- 2) salvar_cad_completo: persiste o CAD inteiro de forma atômica.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_cad_completo(
  _modelo_id uuid,
  _tecidos jsonb,
  _grades jsonb,
  _aviamentos jsonb,
  _etiquetas jsonb,
  _proporcoes jsonb,
  _observacoes_molde text,
  _data_previsao_corte date
)
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

  -- Grade ÚNICA: modelo_grades (fonte) + espelho em cad_grades (planejada=real).
  -- O front já envia só as grades com algum valor.
  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(COALESCE(_grades, '[]'::jsonb)) LOOP
      INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
      VALUES (_modelo_id,
              (g->>'variante_numero')::int,
              COALESCE(g->'grades', '{}'::jsonb),
              COALESCE((g->>'grade_total')::int, 0));

      INSERT INTO public.cad_grades
        (cad_id, variante_numero, grades_planejadas, grades_reais,
         grade_total_planejada, grade_total_real)
      VALUES (v_cad_id,
              (g->>'variante_numero')::int,
              COALESCE(g->'grades', '{}'::jsonb),
              COALESCE(g->'grades', '{}'::jsonb),
              COALESCE((g->>'grade_total')::int, 0),
              COALESCE((g->>'grade_total')::int, 0));
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

  RETURN v_cad_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.salvar_cad_completo(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.salvar_cad_completo(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) enviar_modelo_para_cad: cria o CAD e copia o BOM do Desenvolvimento,
--    atomicamente e de forma idempotente.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enviar_modelo_para_cad(
  _modelo_id uuid,
  _observacoes_tecnicas text DEFAULT NULL,
  _ficha_medida_url text DEFAULT NULL
)
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
  v_grade_total numeric;
  rt record;
  rg record;
  ra record;
  v_idx int := 0;
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

  -- Idempotência: se já existe CAD, não cria um segundo.
  IF EXISTS (SELECT 1 FROM public.cad WHERE modelo_id = _modelo_id) THEN
    RAISE EXCEPTION 'Este modelo já foi enviado para o CAD';
  END IF;

  INSERT INTO public.cad (modelo_id, observacoes_tecnicas, ficha_medida_url, status_corte)
  VALUES (_modelo_id, _observacoes_tecnicas, _ficha_medida_url, 'pendente')
  RETURNING id INTO v_cad_id;

  -- Copia tecidos + variantes (preserva ordem e multiplicador).
  FOR rt IN
    SELECT id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto
    FROM public.modelo_tecidos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    INSERT INTO public.cad_tecidos
      (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
    VALUES
      (v_cad_id, rt.artigo_id, rt.numero, rt.tipo,
       COALESCE(rt.consumo, 0), COALESCE(rt.loss_percent, 0), COALESCE(rt.custo_previsto, 0), 0)
    RETURNING id INTO v_new_tid;

    INSERT INTO public.cad_tecido_variantes
      (cad_tecido_id, variante_tecido_id, ordem, multiplicador,
       quantidade_folhas, metragem_planejada, metragem_enviada)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0
    FROM public.modelo_tecido_variantes mtv
    WHERE mtv.modelo_tecido_id = rt.id;
  END LOOP;

  -- Copia grade planejada -> cad_grades (planejada = real).
  v_grade_total := 0;
  FOR rg IN
    SELECT variante_numero, grades, grade_total
    FROM public.modelo_grades WHERE modelo_id = _modelo_id
  LOOP
    INSERT INTO public.cad_grades
      (cad_id, variante_numero, grades_planejadas, grades_reais,
       grade_total_planejada, grade_total_real)
    VALUES
      (v_cad_id, rg.variante_numero,
       COALESCE(rg.grades, '{}'::jsonb), COALESCE(rg.grades, '{}'::jsonb),
       COALESCE(rg.grade_total, 0), COALESCE(rg.grade_total, 0));
    v_grade_total := v_grade_total + COALESCE(rg.grade_total, 0);
  END LOOP;

  -- Copia aviamentos (qtd = consumo * grade total geral; numero sequencial).
  FOR ra IN
    SELECT aviamento_id, consumo
    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.cad_aviamentos
      (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar)
    VALUES
      (v_cad_id, ra.aviamento_id, v_idx,
       COALESCE(ra.consumo, 0),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4));
  END LOOP;

  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;

  RETURN v_cad_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.enviar_modelo_para_cad(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_modelo_para_cad(uuid, text, text) TO authenticated;
