-- Múltiplas OCs por variante (alocação por saldo) + OCs previstas como plano
-- + nunca esconder OC por saldo (front decide o alerta de cobertura).
--
-- Toca: modelo_tecido_oc_links (estrutura), ocs_disponiveis_variante,
-- salvar_modelo_bom, baixar_estoque_tecido_corte.

-- 1) Estrutura do vínculo: várias OCs por variante, com qtd alocada + prioridade.
ALTER TABLE public.modelo_tecido_oc_links
  DROP CONSTRAINT IF EXISTS modelo_tecido_oc_links_modelo_id_tipo_numero_ordem_key;
ALTER TABLE public.modelo_tecido_oc_links
  ADD COLUMN IF NOT EXISTS quantidade_m numeric NOT NULL DEFAULT 0;
ALTER TABLE public.modelo_tecido_oc_links
  ADD COLUMN IF NOT EXISTS prioridade int NOT NULL DEFAULT 1;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.modelo_tecido_oc_links'::regclass
      AND conname = 'modelo_tecido_oc_links_uniq_oc'
  ) THEN
    ALTER TABLE public.modelo_tecido_oc_links
      ADD CONSTRAINT modelo_tecido_oc_links_uniq_oc
      UNIQUE (modelo_id, tipo, numero, ordem, oc_tecido_item_id);
  END IF;
END $$;

-- 2) OCs disponíveis para a variante: recebidas E previstas, sem esconder por
--    saldo. Reserva de outros modelos agora desconta quantidade_m (não mais o
--    consumo×grade inteiro), coerente com o modelo de várias OCs por variante.
CREATE OR REPLACE FUNCTION public.ocs_disponiveis_variante(_variante_id uuid, _modelo_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recebida DESC, data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      it.id AS oc_tecido_item_id,
      oc.numero_pedido,
      oc.data_entrega,
      oc.created_at,
      (oc.status = 'recebido') AS recebida,
      (
        CASE WHEN a.unidade_medida='kg'
             THEN COALESCE(CASE WHEN oc.status='recebido' THEN it.quantidade_recebida ELSE it.quantidade_pedida END,0) * COALESCE(a.rendimento,0)
             ELSE COALESCE(CASE WHEN oc.status='recebido' THEN it.quantidade_recebida ELSE it.quantidade_pedida END,0) END
      - COALESCE((SELECT SUM(quantidade) FROM public.estoque_tecido_baixas WHERE oc_tecido_item_id = it.id),0)
      - COALESCE((
          SELECT SUM(COALESCE(l.quantidade_m,0))
          FROM public.modelo_tecido_oc_links l
          WHERE l.oc_tecido_item_id = it.id
            AND (_modelo_id IS NULL OR l.modelo_id <> _modelo_id)
            AND NOT EXISTS (
              SELECT 1 FROM public.cad c
              JOIN public.estoque_tecido_baixas b ON b.cad_id = c.id
              WHERE c.modelo_id = l.modelo_id
            )
        ),0)
      ) AS disponivel_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND it.variante_tecido_id = _variante_id
  ) t;
  RETURN v_result;
END;
$$;

-- 3) salvar_modelo_bom: grava vários vínculos por variante com quantidade_m + prioridade.
CREATE OR REPLACE FUNCTION public.salvar_modelo_bom(
  _modelo_id uuid,
  _tecidos jsonb,
  _aviamentos jsonb,
  _grades jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Limpa BOM atual (ordem respeita FKs: variantes/links antes do pai)
  DELETE FROM public.modelo_tecido_variantes
    WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = _modelo_id);
  DELETE FROM public.modelo_tecido_oc_links WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_tecidos WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id;

  -- Tecidos + variantes + oc_links
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

      -- variantes: array indexado (posição = ordem)
      IF jsonb_typeof(t->'variantes') = 'array' THEN
        v_idx := 0;
        FOR v_variante IN
          SELECT CASE WHEN value::text = 'null' OR value IS NULL THEN NULL ELSE (value#>>'{}')::uuid END
          FROM jsonb_array_elements(t->'variantes')
        LOOP
          v_idx := v_idx + 1;
          IF v_variante IS NOT NULL THEN
            INSERT INTO public.modelo_tecido_variantes
              (modelo_tecido_id, variante_tecido_id, ordem)
            VALUES (v_new_tid, v_variante, v_idx);
          END IF;
        END LOOP;
      END IF;

      -- oc_links: array de {ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade}
      -- (vários por ordem: a variante pode ser coberta por mais de uma OC)
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
          ON CONFLICT (modelo_id, tipo, numero, ordem, oc_tecido_item_id) DO UPDATE
            SET quantidade_m = EXCLUDED.quantidade_m, prioridade = EXCLUDED.prioridade;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- Aviamentos
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

  -- Grades (só insere se houver algum valor)
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
$$;

-- 4) Baixa no corte: consome TODOS os vínculos da variante por prioridade
--    (cada um até seu quantidade_m e seu saldo físico), depois FIFO no restante.
CREATE OR REPLACE FUNCTION public.baixar_estoque_tecido_corte(_cad_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_modelo uuid;
  v_total_linhas int := 0;
  v_total_qtd numeric := 0;
  r record;
  link record;
  v_restante numeric;
  v_saldo numeric;
  v_consumir numeric;
  lote record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id, modelo_id INTO v_tenant, v_modelo
  FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'CAD não encontrado';
  END IF;

  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  DELETE FROM public.estoque_tecido_baixas WHERE cad_id = _cad_id;

  FOR r IN
    SELECT ct.tipo, ct.numero, ctv.variante_tecido_id, ctv.ordem, ctv.metragem_enviada
    FROM public.cad_tecidos ct
    JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
    WHERE ct.cad_id = _cad_id
      AND COALESCE(ctv.metragem_enviada,0) > 0
      AND ctv.variante_tecido_id IS NOT NULL
  LOOP
    v_restante := r.metragem_enviada;

    -- Vínculos explícitos (uma ou mais OCs), na ordem de prioridade.
    FOR link IN
      SELECT oc_tecido_item_id, COALESCE(quantidade_m,0) AS qm
      FROM public.modelo_tecido_oc_links
      WHERE modelo_id = v_modelo
        AND tipo = r.tipo AND numero = r.numero AND ordem = r.ordem
        AND variante_tecido_id = r.variante_tecido_id
      ORDER BY prioridade, created_at
    LOOP
      EXIT WHEN v_restante <= 0;
      SELECT saldo_m INTO v_saldo FROM public.saldo_oc_item_m(link.oc_tecido_item_id);
      v_saldo := COALESCE(v_saldo,0);
      IF v_saldo > 0 THEN
        -- cap pela qtd alocada (qm); qm=0 (legado) = sem cap.
        v_consumir := LEAST(v_restante, v_saldo, CASE WHEN link.qm > 0 THEN link.qm ELSE v_restante END);
        IF v_consumir > 0 THEN
          INSERT INTO public.estoque_tecido_baixas
            (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
          VALUES (v_tenant, _cad_id, r.variante_tecido_id, link.oc_tecido_item_id, v_consumir, 'vinculo');
          v_restante := v_restante - v_consumir;
          v_total_linhas := v_total_linhas + 1;
          v_total_qtd := v_total_qtd + v_consumir;
        END IF;
      END IF;
    END LOOP;

    -- Restante: FIFO entre as OCs recebidas, excluindo as já vinculadas acima.
    IF v_restante > 0 THEN
      FOR lote IN
        SELECT it.id AS item_id, s.saldo_m
        FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        CROSS JOIN LATERAL public.saldo_oc_item_m(it.id) s
        WHERE oc.tenant_id = v_tenant
          AND oc.status = 'recebido'
          AND it.variante_tecido_id = r.variante_tecido_id
          AND s.saldo_m > 0
          AND it.id NOT IN (
            SELECT oc_tecido_item_id FROM public.modelo_tecido_oc_links
            WHERE modelo_id = v_modelo AND tipo = r.tipo AND numero = r.numero
              AND ordem = r.ordem AND variante_tecido_id = r.variante_tecido_id
          )
        ORDER BY oc.data_entrega NULLS LAST, oc.created_at
      LOOP
        EXIT WHEN v_restante <= 0;
        v_consumir := LEAST(v_restante, lote.saldo_m);
        INSERT INTO public.estoque_tecido_baixas
          (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
        VALUES (v_tenant, _cad_id, r.variante_tecido_id, lote.item_id, v_consumir, 'fifo');
        v_restante := v_restante - v_consumir;
        v_total_linhas := v_total_linhas + 1;
        v_total_qtd := v_total_qtd + v_consumir;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('linhas', v_total_linhas, 'quantidade', v_total_qtd);
END;
$$;

NOTIFY pgrst, 'reload schema';
