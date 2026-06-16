-- Multiplicador por variante p/ materiais complementares (Tecido 2/3, Forro, Entretela)
-- peças da variante = grade(posição) × multiplicador. Default 1 = comportamento atual.

ALTER TABLE public.modelo_tecido_variantes
  ADD COLUMN IF NOT EXISTS multiplicador numeric NOT NULL DEFAULT 1;
ALTER TABLE public.cad_tecido_variantes
  ADD COLUMN IF NOT EXISTS multiplicador numeric NOT NULL DEFAULT 1;

-- Reserva de estoque passa a multiplicar pela cobertura (multiplicador da variante).

CREATE OR REPLACE FUNCTION public.estoque_tecido_por_artigo()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_result jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH recebido AS (
    SELECT it.artigo_id,
      SUM(CASE WHEN a.unidade_medida = 'kg'
               THEN COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.rendimento, 0)
               ELSE COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0)
          END) AS m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status = 'recebido'
      AND COALESCE(it.cancelado, false) = false
      AND it.artigo_id IS NOT NULL
    GROUP BY it.artigo_id
  ),
  baixa AS (
    SELECT ct.artigo_id, SUM(COALESCE(ctv.metragem_enviada, 0)) AS m
    FROM public.cad_tecido_variantes ctv
    JOIN public.cad_tecidos ct ON ct.id = ctv.cad_tecido_id
    JOIN public.cad c ON c.id = ct.cad_id
    WHERE c.tenant_id = v_tenant
      AND c.enviado_corte = true
      AND ct.artigo_id IS NOT NULL
    GROUP BY ct.artigo_id
  ),
  reservado AS (
    SELECT mt.artigo_id,
      SUM(COALESCE(mt.consumo, 0) * (1 + COALESCE(mt.loss_percent, 0) / 100.0) * COALESCE(mg.grade_total, 0) * COALESCE(mtv.multiplicador, 1)) AS m
    FROM public.modelo_tecidos mt
    JOIN public.modelos m ON m.id = mt.modelo_id
    JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
    LEFT JOIN public.modelo_grades mg
      ON mg.modelo_id = mt.modelo_id AND mg.variante_numero = mtv.ordem
    WHERE m.tenant_id = v_tenant
      AND m.data_aprovacao IS NOT NULL
      AND COALESCE(m.enviado_cad, false) = false
      AND mt.artigo_id IS NOT NULL
    GROUP BY mt.artigo_id
  ),
  artigos_all AS (
    SELECT artigo_id FROM recebido
    UNION
    SELECT artigo_id FROM baixa
    UNION
    SELECT artigo_id FROM reservado
  ),
  calc AS (
    SELECT
      aa.artigo_id,
      (COALESCE(r.m, 0) - COALESCE(b.m, 0))::numeric AS fisico_m,
      COALESCE(rs.m, 0)::numeric AS reservado_m,
      (COALESCE(r.m, 0) - COALESCE(b.m, 0) - COALESCE(rs.m, 0))::numeric AS disponivel_m
    FROM artigos_all aa
    LEFT JOIN recebido r ON r.artigo_id = aa.artigo_id
    LEFT JOIN baixa b ON b.artigo_id = aa.artigo_id
    LEFT JOIN reservado rs ON rs.artigo_id = aa.artigo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'artigo_id', artigo_id,
    'fisico_m', fisico_m,
    'reservado_m', reservado_m,
    'disponivel_m', disponivel_m
  )), '[]'::jsonb)
  INTO v_result
  FROM calc
  WHERE fisico_m <> 0 OR reservado_m <> 0 OR disponivel_m <> 0;

  RETURN v_result;
END;
$function$;

-- salvar_modelo_bom: grava multiplicador por variante (array paralelo 'multiplicadores').
CREATE OR REPLACE FUNCTION public.salvar_modelo_bom(_modelo_id uuid, _tecidos jsonb, _aviamentos jsonb, _grades jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  t jsonb;
  a jsonb;
  g jsonb;
  v_new_tid uuid;
  v_variante uuid;
  v_oc_link jsonb;
  v_idx int;
  v_grades jsonb;
  v_grade_total numeric;
  v_has_value boolean;
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

  DELETE FROM public.modelo_tecido_variantes
    WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = _modelo_id);
  DELETE FROM public.modelo_tecido_oc_links WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_tecidos WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id;

  IF jsonb_typeof(_tecidos) = 'array' THEN
    FOR t IN SELECT value FROM jsonb_array_elements(COALESCE(_tecidos, '[]'::jsonb)) LOOP
      IF (t->>'artigo_id') IS NULL THEN CONTINUE; END IF;

      INSERT INTO public.modelo_tecidos
        (modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto)
      VALUES
        (_modelo_id,
         (t->>'artigo_id')::uuid,
         (t->>'numero')::int,
         t->>'tipo',
         COALESCE((t->>'consumo')::numeric, 0),
         COALESCE((t->>'loss_percent')::numeric, 0),
         COALESCE((t->>'custo_previsto')::numeric, 0))
      RETURNING id INTO v_new_tid;

      IF jsonb_typeof(t->'variantes') = 'array' THEN
        v_idx := 0;
        FOR v_variante IN
          SELECT CASE WHEN value::text = 'null' OR value IS NULL THEN NULL ELSE (value#>>'{}')::uuid END
          FROM jsonb_array_elements(t->'variantes')
        LOOP
          v_idx := v_idx + 1;
          IF v_variante IS NOT NULL THEN
            INSERT INTO public.modelo_tecido_variantes
              (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)
            VALUES (v_new_tid, v_variante, v_idx,
              COALESCE(NULLIF(t->'multiplicadores'->>(v_idx-1), '')::numeric, 1));
          END IF;
        END LOOP;
      END IF;

      IF jsonb_typeof(t->'oc_links') = 'array' THEN
        FOR v_oc_link IN SELECT value FROM jsonb_array_elements(t->'oc_links') LOOP
          IF (v_oc_link->>'oc_tecido_item_id') IS NULL
             OR (v_oc_link->>'variante_tecido_id') IS NULL THEN
            CONTINUE;
          END IF;
          INSERT INTO public.modelo_tecido_oc_links
            (modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
          VALUES
            (_modelo_id,
             t->>'tipo',
             (t->>'numero')::int,
             (v_oc_link->>'ordem')::int,
             (v_oc_link->>'variante_tecido_id')::uuid,
             (v_oc_link->>'oc_tecido_item_id')::uuid,
             COALESCE((v_oc_link->>'quantidade_m')::numeric, 0),
             COALESCE((v_oc_link->>'prioridade')::int, 1))
          ON CONFLICT (modelo_id, tipo, numero, ordem, oc_tecido_item_id)
          DO UPDATE SET
            quantidade_m = EXCLUDED.quantidade_m,
            prioridade = EXCLUDED.prioridade,
            variante_tecido_id = EXCLUDED.variante_tecido_id;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(_aviamentos) = 'array' THEN
    v_idx := 0;
    FOR a IN SELECT value FROM jsonb_array_elements(COALESCE(_aviamentos, '[]'::jsonb)) LOOP
      IF (a->>'aviamento_id') IS NULL THEN CONTINUE; END IF;
      v_idx := v_idx + 1;
      INSERT INTO public.modelo_aviamentos
        (modelo_id, aviamento_id, numero, consumo, loss_percent, custo_previsto)
      VALUES
        (_modelo_id,
         (a->>'aviamento_id')::uuid,
         COALESCE((a->>'numero')::int, v_idx),
         COALESCE((a->>'consumo')::numeric, 0),
         COALESCE((a->>'loss_percent')::numeric, 0),
         COALESCE((a->>'custo_previsto')::numeric, 0));
    END LOOP;
  END IF;

  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(COALESCE(_grades, '[]'::jsonb)) LOOP
      v_grades := COALESCE(g->'grades', '{}'::jsonb);
      v_grade_total := COALESCE((g->>'grade_total')::numeric, 0);
      v_has_value := false;
      IF v_grade_total > 0 THEN
        v_has_value := true;
      ELSIF jsonb_typeof(v_grades) = 'object' THEN
        SELECT EXISTS(
          SELECT 1 FROM jsonb_each_text(v_grades)
          WHERE NULLIF(value,'')::numeric > 0
        ) INTO v_has_value;
      END IF;
      IF v_has_value THEN
        INSERT INTO public.modelo_grades
          (modelo_id, variante_numero, grades, grade_total)
        VALUES
          (_modelo_id,
           (g->>'variante_numero')::int,
           v_grades,
           v_grade_total);
      END IF;
    END LOOP;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';
