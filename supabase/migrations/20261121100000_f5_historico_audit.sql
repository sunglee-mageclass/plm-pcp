-- F5-3 Task 1: helper _audit_evento_secao (1 linha de auditoria por secao da ficha).
-- Chamado de dentro dos _core de Salvar (SECURITY DEFINER). Auditoria nunca derruba o negocio.
BEGIN;
CREATE OR REPLACE FUNCTION public._audit_evento_secao(_modelo_id uuid, _tenant uuid, _entidade text, _tabela text, _diff jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_user uuid; v_nome text;
BEGIN
  IF _diff IS NULL OR _diff = '{}'::jsonb OR jsonb_typeof(_diff) <> 'object' THEN RETURN; END IF;
  v_user := auth.uid();
  SELECT coalesce(nome, email) INTO v_nome FROM public.users WHERE id = v_user;
  INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
  VALUES (_tenant, v_user, v_nome, 'editar', _entidade, _tabela, _modelo_id, 'Editou ' || _entidade, _diff);
EXCEPTION WHEN OTHERS THEN
  RETURN; -- auditoria nunca derruba o negocio (padrao fn_audit)
END $fn$;
REVOKE EXECUTE ON FUNCTION public._audit_evento_secao(uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- F5-3 Task 2: 1 evento de auditoria por SECAO da ficha dentro dos _core de Salvar.
-- Captura o estado ANTERIOR antes do delete-and-reinsert, monta o DIFF RESUMIDO
-- por secao e chama _audit_evento_secao UMA vez por secao (nunca em loop). A
-- montagem do diff fica em sub-bloco EXCEPTION que ENGOLE: a auditoria NUNCA
-- derruba o Salvar. md5 da IDA confere == o corpo VIVO (F5-2 ja aplicado no
-- _salvar_modelo_bom_core: preservacao de grades_programada mantida).
-- ============================================================================

-- Guarda md5: o corpo VIVO tem de ser exatamente o que esperamos antes de
-- acrescentar a auditoria por cima (nao reverter F5-2 nem outra frente).
DO $guard$
DECLARE
  v record;
  v_esperado jsonb := jsonb_build_object(
    '_salvar_modelo_bom_core(uuid,jsonb,jsonb,jsonb,integer)',                      '1641592f85a8ba02a3ebf36383680a66',
    '_salvar_cad_completo_core(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)',      'de45e1c2d045648ebbb4a9b3a86bb7c7',
    '_salvar_etiquetas_modelo_core(uuid,jsonb)',                                    '381316645339694d684c04258945d87c'
  );
  v_md5 text;
BEGIN
  FOR v IN SELECT key AS assin, value::text AS md5 FROM jsonb_each_text(v_esperado) LOOP
    v_md5 := md5(pg_get_functiondef(('public.'||v.assin)::regprocedure));
    IF v_md5 <> v.md5 THEN
      RAISE EXCEPTION 'md5 divergente em %: vivo=% esperado=%', v.assin, v_md5, v.md5;
    END IF;
  END LOOP;
END $guard$;

-- ─────────────────────────── _salvar_modelo_bom_core (Tecidos / Aviamentos / Grade) ───────────────────────────
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
  v_prog jsonb;  -- Task 7: mapa variante_numero(text) -> grades_programada, preservado entre o DELETE e o reinsert
  -- F5-3 Task 2: estado ANTERIOR por secao (capturado antes do delete-and-reinsert)
  v_aud_tec_antes jsonb;
  v_aud_avi_antes jsonb;
  v_aud_gr_antes jsonb;
  v_aud_diff jsonb;
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

  -- F5-3 Task 2: fotografa o estado ANTERIOR das 3 secoes antes dos DELETE.
  SELECT jsonb_object_agg(numero::text||'|'||tipo,
                          jsonb_build_object('artigo', artigo_id::text, 'consumo', consumo, 'loss', loss_percent))
    INTO v_aud_tec_antes FROM public.modelo_tecidos WHERE modelo_id = _modelo_id;
  SELECT jsonb_object_agg(aviamento_id::text, consumo)
    INTO v_aud_avi_antes FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id;
  SELECT jsonb_object_agg(variante_numero::text, grades)
    INTO v_aud_gr_antes FROM public.modelo_grades WHERE modelo_id = _modelo_id;

  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR do BOM (antes de qualquer delete)
  PERFORM public._modelo_bom_snapshot(_modelo_id, 'dev_bom');

  DELETE FROM public.modelo_tecido_variantes
    WHERE modelo_tecido_id IN (SELECT id FROM public.modelo_tecidos WHERE modelo_id = _modelo_id);
  DELETE FROM public.modelo_tecido_oc_links WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_tecidos WHERE modelo_id = _modelo_id;
  DELETE FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id;
  -- Task 7: preserva a Programada (meta oficial F5-2) por variante ANTES do delete-and-reinsert.
  SELECT jsonb_object_agg(variante_numero::text, grades_programada)
       FILTER (WHERE grades_programada IS NOT NULL)
    INTO v_prog
    FROM public.modelo_grades WHERE modelo_id = _modelo_id;

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
          (modelo_id, variante_numero, grades, grade_total, grades_programada)
        VALUES
          (_modelo_id,
           (g->>'variante_numero')::int,
           v_grades,
           v_grade_total,
           v_prog -> (g->>'variante_numero'));  -- Task 7: NULL se a variante nao tinha Programada
      END IF;
    END LOOP;
  END IF;

  -- F5-3 Task 2: monta o DIFF RESUMIDO por secao e grava 1 evento por secao (so se mudou).
  -- Protegido: a montagem NUNCA pode derrubar o Salvar (o helper ja engole, mas o diff tambem).
  BEGIN
    -- Tecidos: por (numero,tipo) -> artigo (nome)/consumo/loss
    WITH antes AS (SELECT COALESCE(v_aud_tec_antes, '{}'::jsonb) m),
         depois AS (
           SELECT COALESCE(jsonb_object_agg(numero::text||'|'||tipo,
                     jsonb_build_object('artigo', artigo_id::text, 'consumo', consumo, 'loss', loss_percent)), '{}'::jsonb) m
           FROM public.modelo_tecidos WHERE modelo_id = _modelo_id),
         chaves AS (SELECT DISTINCT k FROM antes a, depois d, jsonb_object_keys(a.m || d.m) k),
         linhas AS (
           SELECT
             CASE lower(split_part(k,'|',2)) WHEN 'tecido' THEN 'Tecido' WHEN 'forro' THEN 'Forro'
                  WHEN 'entretela' THEN 'Entretela' ELSE initcap(split_part(k,'|',2)) END || ' ' || split_part(k,'|',1) AS rot,
             (SELECT m->k FROM antes) ja, (SELECT m->k FROM depois) jd
           FROM chaves)
    SELECT jsonb_strip_nulls(jsonb_object_agg(kk, vv)) INTO v_aud_diff FROM (
      SELECT rot||' · artigo' kk,
             jsonb_build_object('de', (SELECT nome FROM public.artigos WHERE id = (ja->>'artigo')::uuid),
                                'para', (SELECT nome FROM public.artigos WHERE id = (jd->>'artigo')::uuid)) vv
        FROM linhas WHERE (ja->>'artigo') IS DISTINCT FROM (jd->>'artigo')
      UNION ALL
      SELECT rot||' · consumo' kk, jsonb_build_object('de', (ja->>'consumo')::numeric, 'para', (jd->>'consumo')::numeric) vv
        FROM linhas WHERE (ja->>'consumo') IS DISTINCT FROM (jd->>'consumo')
      UNION ALL
      SELECT rot||' · perda (%)' kk, jsonb_build_object('de', (ja->>'loss')::numeric, 'para', (jd->>'loss')::numeric) vv
        FROM linhas WHERE (ja->>'loss') IS DISTINCT FROM (jd->>'loss')
    ) s;
    PERFORM public._audit_evento_secao(_modelo_id, v_tenant, 'Tecidos', 'modelo_tecidos', v_aud_diff);

    -- Aviamentos: por aviamento_id -> consumo
    WITH antes AS (SELECT COALESCE(v_aud_avi_antes, '{}'::jsonb) m),
         depois AS (SELECT COALESCE(jsonb_object_agg(aviamento_id::text, consumo), '{}'::jsonb) m
                    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id),
         chaves AS (SELECT DISTINCT k FROM antes a, depois d, jsonb_object_keys(a.m || d.m) k)
    SELECT jsonb_strip_nulls(jsonb_object_agg(
             'Aviamento ' || COALESCE((SELECT codigo_nome FROM public.aviamentos WHERE id = k::uuid), left(k,8)) || ' · consumo',
             jsonb_build_object('de', (SELECT (m->k)::numeric FROM antes), 'para', (SELECT (m->k)::numeric FROM depois))))
      INTO v_aud_diff FROM chaves
     WHERE (SELECT m->>k FROM antes) IS DISTINCT FROM (SELECT m->>k FROM depois);
    PERFORM public._audit_evento_secao(_modelo_id, v_tenant, 'Aviamentos', 'modelo_aviamentos', v_aud_diff);

    -- Grade: por variante_numero/tamanho -> quantidade
    WITH antes AS (SELECT COALESCE(v_aud_gr_antes, '{}'::jsonb) m),
         depois AS (SELECT COALESCE(jsonb_object_agg(variante_numero::text, grades), '{}'::jsonb) m
                    FROM public.modelo_grades WHERE modelo_id = _modelo_id),
         vns AS (SELECT DISTINCT k vn FROM antes a, depois d, jsonb_object_keys(a.m || d.m) k),
         pares AS (
           SELECT vn, tam FROM vns
           CROSS JOIN LATERAL (
             SELECT DISTINCT kk tam FROM (
               SELECT jsonb_object_keys(COALESCE((SELECT m->vn FROM antes), '{}'::jsonb)) kk
               UNION SELECT jsonb_object_keys(COALESCE((SELECT m->vn FROM depois), '{}'::jsonb))
             ) t
           ) tt)
    SELECT jsonb_strip_nulls(jsonb_object_agg(
             'Grade v' || vn || ' ' || CASE WHEN position('|' in tam) > 0 THEN split_part(tam,'|',2) ELSE tam END,
             jsonb_build_object(
               'de',   NULLIF((SELECT m->vn->>tam FROM antes), '')::numeric,
               'para', NULLIF((SELECT m->vn->>tam FROM depois), '')::numeric)))
      INTO v_aud_diff FROM pares
     WHERE NULLIF((SELECT m->vn->>tam FROM antes), '')::numeric
       IS DISTINCT FROM NULLIF((SELECT m->vn->>tam FROM depois), '')::numeric;
    PERFORM public._audit_evento_secao(_modelo_id, v_tenant, 'Grade', 'modelo_grades', v_aud_diff);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a auditoria NUNCA derruba o Salvar
  END;
END;
$function$;

-- ─────────────────────────── _salvar_cad_completo_core (CAD) ───────────────────────────
CREATE OR REPLACE FUNCTION public._salvar_cad_completo_core(_modelo_id uuid, _tecidos jsonb, _grades jsonb, _aviamentos jsonb, _etiquetas jsonb, _proporcoes jsonb, _observacoes_molde text, _data_previsao_corte date)
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
  v_has_grades boolean := (jsonb_typeof(_grades) = 'array' AND jsonb_array_length(_grades) > 0);
  -- F5-3 Task 2: estado ANTERIOR dos campos editaveis do CAD (antes do delete-and-reinsert)
  v_aud_tf_antes jsonb;     -- tamanho_folha por numero|tipo
  v_aud_var_antes jsonb;    -- quantidade_folhas/metragem_planejada por numero|tipo|ordem
  v_aud_molde_antes text;
  v_aud_diff jsonb;
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

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    WHERE (tt->>'artigo_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.artigos x WHERE x.id=(tt->>'artigo_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Artigo de outra loja no CAD' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_tecidos)='array' THEN _tecidos ELSE '[]'::jsonb END) tt
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(tt->'variantes')='array' THEN tt->'variantes' ELSE '[]'::jsonb END) vv
    WHERE (vv->>'variante_tecido_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido x WHERE x.id=(vv->>'variante_tecido_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Variante de tecido de outra loja no CAD' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_aviamentos)='array' THEN _aviamentos ELSE '[]'::jsonb END) aa
    WHERE (aa->>'aviamento_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.aviamentos x WHERE x.id=(aa->>'aviamento_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Aviamento de outra loja no CAD' USING ERRCODE='42501'; END IF;

  -- Variante de aviamento (opcional): tem de pertencer ao tenant E ao aviamento da MESMA linha.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_aviamentos)='array' THEN _aviamentos ELSE '[]'::jsonb END) aa
    WHERE (aa->>'variante_aviamento_id') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.variantes_aviamento va
        WHERE va.id = (aa->>'variante_aviamento_id')::uuid
          AND va.tenant_id = v_tenant
          AND va.aviamento_id = (aa->>'aviamento_id')::uuid)
  ) THEN RAISE EXCEPTION 'Variante de aviamento inválida (não pertence ao aviamento/loja) no CAD' USING ERRCODE='42501'; END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_etiquetas)='array' THEN _etiquetas ELSE '[]'::jsonb END) ee
    WHERE (ee->>'etiqueta_id') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.etiquetas x WHERE x.id=(ee->>'etiqueta_id')::uuid AND x.tenant_id=v_tenant)
  ) THEN RAISE EXCEPTION 'Etiqueta de outra loja no CAD' USING ERRCODE='42501'; END IF;

  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id;
  IF v_cad_id IS NULL THEN
    -- [seg s1 M2] CAD so nasce depois da Ordem de Criacao (a tela ja nao cria - D2 da F3.3): CAD sem Ordem deixava o card
    -- impossivel de excluir (FK cad.modelo_id NO ACTION). ASCII (tela: erro-mensagem.ts).
    IF NOT coalesce((SELECT m.ordem_criacao_enviada FROM public.modelos m WHERE m.id = _modelo_id), false) THEN
      RAISE EXCEPTION 'cad_sem_ordem: envie a Ordem de Criacao antes de gravar o CAD' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.cad (modelo_id, status_corte)
    VALUES (_modelo_id, 'pendente')
    RETURNING id INTO v_cad_id;
  END IF;

  -- F5-3 Task 2: fotografa os campos editaveis do CAD antes do delete-and-reinsert.
  SELECT jsonb_object_agg(numero::text||'|'||tipo, tamanho_folha)
    INTO v_aud_tf_antes FROM public.cad_tecidos WHERE cad_id = v_cad_id;
  SELECT jsonb_object_agg(ct.numero::text||'|'||ct.tipo||'|'||ctv.ordem::text,
                          jsonb_build_object('qf', ctv.quantidade_folhas, 'mp', ctv.metragem_planejada))
    INTO v_aud_var_antes
    FROM public.cad_tecido_variantes ctv
    JOIN public.cad_tecidos ct ON ct.id = ctv.cad_tecido_id
   WHERE ct.cad_id = v_cad_id;
  SELECT observacoes_molde INTO v_aud_molde_antes FROM public.cad WHERE id = v_cad_id;

  DELETE FROM public.cad_tecidos WHERE cad_id = v_cad_id;          -- cascateia variantes
  DELETE FROM public.cad_aviamentos WHERE cad_id = v_cad_id;
  DELETE FROM public.cad_etiquetas WHERE cad_id = v_cad_id;

  IF v_has_grades THEN
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

    DELETE FROM public.cad_grades WHERE cad_id = v_cad_id;
    DELETE FROM public.modelo_grades WHERE modelo_id = _modelo_id;

    FOR g IN SELECT value FROM jsonb_array_elements(_grades) LOOP
      v_key := g->>'variante_numero';

      INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
      VALUES (_modelo_id, v_key::int, COALESCE(g->'grades', '{}'::jsonb), COALESCE((g->>'grade_total')::int, 0));

      INSERT INTO public.cad_grades
        (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
      VALUES (v_cad_id, v_key::int, COALESCE(g->'grades', '{}'::jsonb),
              CASE WHEN v_cq_confirmado AND v_reais ? v_key THEN v_reais->v_key->'gr' ELSE COALESCE(g->'grades', '{}'::jsonb) END,
              COALESCE((g->>'grade_total')::int, 0),
              CASE WHEN v_cq_confirmado AND v_reais ? v_key THEN COALESCE((v_reais->v_key->>'gt')::int, 0) ELSE COALESCE((g->>'grade_total')::int, 0) END);
    END LOOP;

    IF v_cq_confirmado THEN
      FOR v_key IN SELECT jsonb_object_keys(v_reais) LOOP
        IF NOT EXISTS (SELECT 1 FROM public.cad_grades WHERE cad_id = v_cad_id AND variante_numero = v_key::int) THEN
          INSERT INTO public.cad_grades
            (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
          VALUES (v_cad_id, v_key::int, '{}'::jsonb, v_reais->v_key->'gr', 0, COALESCE((v_reais->v_key->>'gt')::int, 0));
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Tecidos + variantes
  IF jsonb_typeof(_tecidos) = 'array' THEN
    FOR t IN SELECT value FROM jsonb_array_elements(COALESCE(_tecidos, '[]'::jsonb)) LOOP
      INSERT INTO public.cad_tecidos
        (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
      VALUES
        (v_cad_id, (t->>'artigo_id')::uuid, (t->>'numero')::int, COALESCE(t->>'tipo', 'tecido'),
         COALESCE((t->>'consumo_cad')::numeric, 0), COALESCE((t->>'loss_percent_cad')::numeric, 0),
         COALESCE((t->>'custo_cad')::numeric, 0), COALESCE((t->>'tamanho_folha')::numeric, 0))
      RETURNING id INTO v_new_tid;

      IF jsonb_typeof(t->'variantes') = 'array' THEN
        FOR v IN SELECT value FROM jsonb_array_elements(t->'variantes') LOOP
          INSERT INTO public.cad_tecido_variantes
            (cad_tecido_id, variante_tecido_id, ordem, multiplicador, quantidade_folhas, metragem_planejada, metragem_enviada)
          VALUES
            (v_new_tid, (v->>'variante_tecido_id')::uuid, (v->>'ordem')::int,
             COALESCE(NULLIF(v->>'multiplicador','')::numeric, 1), COALESCE((v->>'quantidade_folhas')::numeric, 0),
             COALESCE((v->>'metragem_planejada')::numeric, 0), COALESCE((v->>'metragem_enviada')::numeric, 0));
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- Poda variantes DELETADAS (não estão mais no tecido-1) de cad_grades/cq/direcionamento e a
  -- baixa de estoque órfã. Helper compartilhado (localiza mudanças futuras da poda).
  PERFORM public._poda_variantes_cad(v_cad_id, _modelo_id);

  UPDATE public.modelos SET proporcoes = COALESCE(_proporcoes, '{}'::jsonb) WHERE id = _modelo_id;

  IF jsonb_typeof(_aviamentos) = 'array' THEN
    FOR a IN SELECT value FROM jsonb_array_elements(COALESCE(_aviamentos, '[]'::jsonb)) LOOP
      INSERT INTO public.cad_aviamentos (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
      VALUES (v_cad_id, (a->>'aviamento_id')::uuid, (a->>'numero')::int, COALESCE((a->>'consumo')::numeric, 0),
              COALESCE((a->>'quantidade_enviar')::numeric, 0), COALESCE((a->>'quantidade_separar')::numeric, 0),
              NULLIF(a->>'variante_aviamento_id','')::uuid);
    END LOOP;
  END IF;

  IF jsonb_typeof(_etiquetas) = 'array' THEN
    FOR e IN SELECT value FROM jsonb_array_elements(COALESCE(_etiquetas, '[]'::jsonb)) LOOP
      INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar, enviar_por_tamanho)
      VALUES (v_cad_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'cor_id','')::uuid, COALESCE((e->>'consumo')::numeric, 0),
              COALESCE((e->>'quantidade_planejada')::numeric, 0), COALESCE((e->>'quantidade_enviar')::numeric, 0),
              COALESCE(e->'enviar_por_tamanho', '{}'::jsonb));
    END LOOP;
  END IF;

  UPDATE public.cad
     SET observacoes_molde = _observacoes_molde,
         data_previsao_corte = COALESCE(_data_previsao_corte, data_previsao_corte)
   WHERE id = v_cad_id;

  UPDATE public.modelo_tecidos mt
     SET consumo = ct.consumo_cad, loss_percent = ct.loss_percent_cad
    FROM public.cad_tecidos ct
   WHERE ct.cad_id = v_cad_id AND mt.modelo_id = _modelo_id AND mt.tipo = ct.tipo AND mt.numero = ct.numero;

  -- F5-3 Task 2: DIFF RESUMIDO do CAD (campos editaveis). Protegido: nunca derruba o Salvar.
  BEGIN
    WITH
    tf AS (  -- tamanho_folha por numero|tipo
      SELECT COALESCE(v_aud_tf_antes, '{}'::jsonb) ant,
             (SELECT COALESCE(jsonb_object_agg(numero::text||'|'||tipo, tamanho_folha), '{}'::jsonb)
                FROM public.cad_tecidos WHERE cad_id = v_cad_id) dep),
    tfk AS (SELECT DISTINCT k FROM tf, jsonb_object_keys(tf.ant || tf.dep) k),
    tfd AS (
      SELECT 'Tecido '||split_part(k,'|',1)||' · tamanho da folha' rot,
             NULLIF((SELECT ant->>k FROM tf), '')::numeric de,
             NULLIF((SELECT dep->>k FROM tf), '')::numeric para
        FROM tfk),
    var AS (  -- quantidade_folhas / metragem_planejada por numero|tipo|ordem
      SELECT COALESCE(v_aud_var_antes, '{}'::jsonb) ant,
             (SELECT COALESCE(jsonb_object_agg(ct.numero::text||'|'||ct.tipo||'|'||ctv.ordem::text,
                        jsonb_build_object('qf', ctv.quantidade_folhas, 'mp', ctv.metragem_planejada)), '{}'::jsonb)
                FROM public.cad_tecido_variantes ctv
                JOIN public.cad_tecidos ct ON ct.id = ctv.cad_tecido_id
               WHERE ct.cad_id = v_cad_id) dep),
    vark AS (SELECT DISTINCT k FROM var, jsonb_object_keys(var.ant || var.dep) k),
    vard AS (
      SELECT 'Tecido '||split_part(k,'|',1)||' v'||split_part(k,'|',3) rot,
             (SELECT ant->k FROM var) ja, (SELECT dep->k FROM var) jd
        FROM vark)
    SELECT jsonb_strip_nulls(jsonb_object_agg(kk, vv)) INTO v_aud_diff FROM (
      SELECT rot kk, jsonb_build_object('de', de, 'para', para) vv FROM tfd WHERE de IS DISTINCT FROM para
      UNION ALL
      SELECT rot||' · qtd folhas' kk, jsonb_build_object('de', (ja->>'qf')::numeric, 'para', (jd->>'qf')::numeric) vv
        FROM vard WHERE (ja->>'qf') IS DISTINCT FROM (jd->>'qf')
      UNION ALL
      SELECT rot||' · metragem planejada' kk, jsonb_build_object('de', (ja->>'mp')::numeric, 'para', (jd->>'mp')::numeric) vv
        FROM vard WHERE (ja->>'mp') IS DISTINCT FROM (jd->>'mp')
    ) s;
    IF _observacoes_molde IS DISTINCT FROM v_aud_molde_antes THEN
      v_aud_diff := COALESCE(v_aud_diff, '{}'::jsonb)
        || jsonb_build_object('Observações do molde', jsonb_build_object('de', v_aud_molde_antes, 'para', _observacoes_molde));
    END IF;
    PERFORM public._audit_evento_secao(_modelo_id, v_tenant, 'CAD', 'cad', v_aud_diff);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a auditoria NUNCA derruba o Salvar
  END;

  RETURN v_cad_id;
END;
$function$;

-- ─────────────────────────── _salvar_etiquetas_modelo_core (Insumos) ───────────────────────────
CREATE OR REPLACE FUNCTION public._salvar_etiquetas_modelo_core(_modelo_id uuid, _etiquetas jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  r record;
  v_manter uuid[] := '{}';
  v_novo uuid;
  -- F5-3 Task 2: estado ANTERIOR por etiqueta_id|cor_id -> consumo
  v_aud_antes jsonb;
  v_aud_diff jsonb;
BEGIN
  IF jsonb_typeof(_etiquetas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'etiquetas_invalidas: esperado uma lista' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.tenant_id INTO v_tenant FROM public.modelos m WHERE m.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;

  -- F5-3 Task 2: fotografa o estado ANTERIOR (consumo por etiqueta_id|cor_id).
  SELECT jsonb_object_agg(etiqueta_id::text||'|'||COALESCE(cor_id::text,'-'), consumo)
    INTO v_aud_antes FROM public.modelo_etiquetas WHERE modelo_id = _modelo_id;

  -- Linhas validas, com a posicao entre as validas (planoEtiquetas: numero = i + 1 sobre o filtro).
  FOR r IN
    SELECT
      NULLIF(x.e->>'id', '')::uuid                                   AS id,
      (x.e->>'etiqueta_id')::uuid                                    AS etiqueta_id,
      NULLIF(x.e->>'cor_id', '')::uuid                               AS cor_id,
      row_number() OVER (ORDER BY x.ord)::int                        AS numero,
      round(COALESCE(NULLIF(x.e->>'consumo', '')::numeric, 0), 4)        AS consumo,
      round(COALESCE(NULLIF(x.e->>'loss_percent', '')::numeric, 0), 2)   AS loss_percent,
      round(COALESCE(NULLIF(x.e->>'custo_previsto', '')::numeric, 0), 2) AS custo_previsto
    FROM jsonb_array_elements(_etiquetas) WITH ORDINALITY AS x(e, ord)
    WHERE NULLIF(x.e->>'etiqueta_id', '') IS NOT NULL
    ORDER BY x.ord
  LOOP
    IF r.id IS NOT NULL THEN
      v_manter := v_manter || r.id;
      UPDATE public.modelo_etiquetas me
         SET etiqueta_id = r.etiqueta_id, cor_id = r.cor_id, numero = r.numero,
             consumo = r.consumo, loss_percent = r.loss_percent, custo_previsto = r.custo_previsto
       WHERE me.id = r.id AND me.modelo_id = _modelo_id
         AND (me.etiqueta_id IS DISTINCT FROM r.etiqueta_id OR me.cor_id IS DISTINCT FROM r.cor_id
              OR me.numero IS DISTINCT FROM r.numero OR me.consumo IS DISTINCT FROM r.consumo
              OR me.loss_percent IS DISTINCT FROM r.loss_percent OR me.custo_previsto IS DISTINCT FROM r.custo_previsto);
      IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.modelo_etiquetas me WHERE me.id = r.id AND me.modelo_id = _modelo_id) THEN
        -- id que nao e deste modelo (ou sumiu): nunca grava calado nem recria com outro id.
        RAISE EXCEPTION 'nao_encontrado: etiqueta' USING ERRCODE = 'P0002';
      END IF;
    ELSE
      INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
      VALUES (v_tenant, _modelo_id, r.etiqueta_id, r.cor_id, r.numero, r.consumo, r.loss_percent, r.custo_previsto)
      RETURNING id INTO v_novo;
      -- a linha recem-criada tambem e "mantida" (senao o DELETE abaixo a apagaria).
      v_manter := v_manter || v_novo;
    END IF;
  END LOOP;

  -- Apaga so as linhas DESTE modelo que o estado completo nao manteve.
  DELETE FROM public.modelo_etiquetas me
   WHERE me.modelo_id = _modelo_id AND NOT (me.id = ANY (v_manter));

  -- F5-3 Task 2: DIFF RESUMIDO dos Insumos (consumo por etiqueta_id|cor_id). Protegido: nunca derruba o Salvar.
  BEGIN
    WITH antes AS (SELECT COALESCE(v_aud_antes, '{}'::jsonb) m),
         depois AS (SELECT COALESCE(jsonb_object_agg(etiqueta_id::text||'|'||COALESCE(cor_id::text,'-'), consumo), '{}'::jsonb) m
                    FROM public.modelo_etiquetas WHERE modelo_id = _modelo_id),
         chaves AS (SELECT DISTINCT k FROM antes a, depois d, jsonb_object_keys(a.m || d.m) k)
    SELECT jsonb_strip_nulls(jsonb_object_agg(
             'Insumo ' || COALESCE((SELECT nome FROM public.etiquetas WHERE id = split_part(k,'|',1)::uuid), left(k,8))
               || CASE WHEN split_part(k,'|',2) <> '-'
                       THEN ' (' || COALESCE((SELECT nome FROM public.cores WHERE id = split_part(k,'|',2)::uuid), 'cor') || ')'
                       ELSE '' END
               || ' · consumo',
             jsonb_build_object('de', (SELECT (m->k)::numeric FROM antes), 'para', (SELECT (m->k)::numeric FROM depois))))
      INTO v_aud_diff FROM chaves
     WHERE (SELECT m->>k FROM antes) IS DISTINCT FROM (SELECT m->>k FROM depois);
    PERFORM public._audit_evento_secao(_modelo_id, v_tenant, 'Insumos', 'modelo_etiquetas', v_aud_diff);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- a auditoria NUNCA derruba o Salvar
  END;
END
$function$;
COMMIT;
