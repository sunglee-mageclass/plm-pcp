-- Task 1 (Multi) — casar variantes N-pra-N + substitutos
-- Troca a coluna SINGULAR (Fatia 1) complementa_variante_id uuid -> ARRAY
-- complementa_variante_ids uuid[], para uma variante do bloco complementar
-- casar com VÁRIAS variantes do Tecido 1. Fatia 1 NÃO foi pushada -> troca limpa
-- (migrar singular->array e DROPAR o singular).
--
-- Aditivo ao comportamento; NÃO toca estoque/reserva/abate.
-- Migration DESTRUTIVA (DROP COLUMN) -> BEGIN;…COMMIT; + idempotente.
-- Funções: CREATE OR REPLACE (nunca DROP) + REVOKE restatado (invariante #9).

BEGIN;

-- ============================================================================
-- Step 1 — colunas: singular uuid -> array uuid[] (ambas as tabelas)
-- (array de uuid NÃO tem FK — validação de tenant vive no _core, Step 2)
-- ============================================================================

-- modelo_tecido_variantes
ALTER TABLE public.modelo_tecido_variantes
  ADD COLUMN IF NOT EXISTS complementa_variante_ids uuid[];
UPDATE public.modelo_tecido_variantes
  SET complementa_variante_ids = ARRAY[complementa_variante_id]
  WHERE complementa_variante_id IS NOT NULL
    AND complementa_variante_ids IS NULL;
ALTER TABLE public.modelo_tecido_variantes
  DROP COLUMN IF EXISTS complementa_variante_id;

-- cad_tecido_variantes
ALTER TABLE public.cad_tecido_variantes
  ADD COLUMN IF NOT EXISTS complementa_variante_ids uuid[];
UPDATE public.cad_tecido_variantes
  SET complementa_variante_ids = ARRAY[complementa_variante_id]
  WHERE complementa_variante_id IS NOT NULL
    AND complementa_variante_ids IS NULL;
ALTER TABLE public.cad_tecido_variantes
  DROP COLUMN IF EXISTS complementa_variante_id;

-- ============================================================================
-- Step 2 — _salvar_modelo_bom_core: grava o ARRAY + guard de tenant N-pra-N
-- Delta vs. Fatia 1:
--   (a) guard "Variante complementar de outra loja no BOM" ganha UM nível a
--       mais de jsonb_array_elements (cada cc agora é um ARRAY -> itera ce).
--   (b) INSERT das variantes: coluna complementa_variante_id -> _ids e valor
--       escalar -> ARRAY(...) da sub-array (NULL quando vazio).
-- NADA MAIS muda.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._salvar_modelo_bom_core(_modelo_id uuid, _tecidos jsonb, _aviamentos jsonb, _grades jsonb, _rev_base integer DEFAULT NULL::integer)
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
  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.modelos
        where id = _modelo_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

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

  -- [NOVO] Isolamento dos IDs aninhados: todos devem pertencer ao tenant do modelo.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    WHERE (tt->>'artigo_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.artigos x WHERE x.id=(tt->>'artigo_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Artigo de outra loja no BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'variantes')='array' THEN tt->'variantes' ELSE '[]'::jsonb END) vv
    WHERE jsonb_typeof(vv) <> 'null' AND (vv#>>'{}') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido x WHERE x.id=(vv#>>'{}')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Variante de tecido de outra loja no BOM' USING ERRCODE='42501'; END IF;

  -- [casar variantes MULTI] cada elemento de 'complementas' agora é um ARRAY de
  -- uuids (variantes do Tecido 1 casadas com aquele slot). TODOS devem pertencer
  -- ao tenant do modelo — mesmo contrato dos demais ids aninhados. Um nível a
  -- mais de jsonb_array_elements: cc (o slot) é um array -> itera ce (cada uuid).
  -- cc não-array vira '[]' -> não itera (seguro; cobre payload legado escalar).
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'complementas')='array' THEN tt->'complementas' ELSE '[]'::jsonb END) cc
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cc)='array' THEN cc ELSE '[]'::jsonb END) ce
    WHERE jsonb_typeof(ce) <> 'null' AND (ce#>>'{}') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido x WHERE x.id=(ce#>>'{}')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Variante complementar de outra loja no BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'oc_links')='array' THEN tt->'oc_links' ELSE '[]'::jsonb END) ol
    WHERE (ol->>'variante_tecido_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido x WHERE x.id=(ol->>'variante_tecido_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Variante do vínculo de OC de outra loja no BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'oc_links')='array' THEN tt->'oc_links' ELSE '[]'::jsonb END) ol
    WHERE (ol->>'oc_tecido_item_id') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
        WHERE it.id=(ol->>'oc_tecido_item_id')::uuid AND oc.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Item de OC de outra loja no vínculo do BOM' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_aviamentos)='array' THEN _aviamentos ELSE '[]'::jsonb END) aa
    WHERE (aa->>'aviamento_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.aviamentos x WHERE x.id=(aa->>'aviamento_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Aviamento de outra loja no BOM' USING ERRCODE='42501'; END IF;

  -- Variante de aviamento (opcional): tem de pertencer ao tenant E ao aviamento da MESMA linha.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_aviamentos)='array' THEN _aviamentos ELSE '[]'::jsonb END) aa
    WHERE (aa->>'variante_aviamento_id') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.variantes_aviamento va
        WHERE va.id = (aa->>'variante_aviamento_id')::uuid
          AND va.tenant_id = v_tenant
          AND va.aviamento_id = (aa->>'aviamento_id')::uuid)
  ) THEN RAISE EXCEPTION 'Variante de aviamento inválida (não pertence ao aviamento/loja) no BOM' USING ERRCODE='42501'; END IF;
  -- [/NOVO]

  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR do BOM (antes de qualquer delete)
  PERFORM public._modelo_bom_snapshot(_modelo_id, 'dev_bom');

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
              (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
            VALUES (v_new_tid, v_variante, v_idx,
              COALESCE(NULLIF(t->'multiplicadores'->>(v_idx-1), '')::numeric, 1),
              CASE WHEN jsonb_typeof(t->'complementas'->(v_idx-1))='array'
                THEN NULLIF(ARRAY(SELECT (e#>>'{}')::uuid
                             FROM jsonb_array_elements(t->'complementas'->(v_idx-1)) e
                             WHERE jsonb_typeof(e)<>'null' AND (e#>>'{}') IS NOT NULL),
                            '{}'::uuid[])
                ELSE NULL END);
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
        (modelo_id, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id)
      VALUES
        (_modelo_id,
         (a->>'aviamento_id')::uuid,
         COALESCE((a->>'numero')::int, v_idx),
         COALESCE((a->>'consumo')::numeric, 0),
         COALESCE((a->>'loss_percent')::numeric, 0),
         COALESCE((a->>'custo_previsto')::numeric, 0),
         NULLIF(a->>'variante_aviamento_id','')::uuid);
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

-- invariante #9: revogar dos TRÊS (PUBLIC concede a anon/authenticated por herança)
REVOKE EXECUTE ON FUNCTION public._salvar_modelo_bom_core(uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- Step 3 — _enviar_modelo_para_cad_core: copia mtv.complementa_variante_ids
-- (a coluna do cad agora é array, criada no Step 1). Único delta.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._enviar_modelo_para_cad_core(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
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
  v_gate_ok boolean;
  v_gate_label text;
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

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id)) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id;
  IF v_cad_id IS NOT NULL THEN
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
    RETURN v_cad_id;
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
       quantidade_folhas, metragem_planejada, metragem_enviada, complementa_variante_ids)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0, mtv.complementa_variante_ids
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
  -- [NOVO] leva a variante_aviamento_id do BOM p/ o CAD → cad_aviamentos vira
  -- POR aviamento×variante (base da "a separar" editável por variante na Explosão).
  FOR ra IN
    SELECT aviamento_id, consumo, variante_aviamento_id
    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.cad_aviamentos
      (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
    VALUES
      (v_cad_id, ra.aviamento_id, v_idx,
       COALESCE(ra.consumo, 0),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ra.variante_aviamento_id);
  END LOOP;

  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;

  RETURN v_cad_id;
END;
$function$;

-- invariante #9: restatar o REVOKE (CREATE OR REPLACE preserva ACL, mas restatamos
-- por disciplina — baseline já era anon=f/authenticated=f).
REVOKE EXECUTE ON FUNCTION public._enviar_modelo_para_cad_core(uuid,text,text) FROM PUBLIC, anon, authenticated;

COMMIT;
