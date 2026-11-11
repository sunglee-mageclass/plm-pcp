BEGIN;
-- Coluna da Programada (meta oficial). NULL = ainda não congelada.
ALTER TABLE public.modelo_grades ADD COLUMN IF NOT EXISTS grades_programada jsonb;

-- Congela ao enviar a Ordem de Criação: copia grades -> grades_programada nas linhas que ainda estão NULL.
-- AFTER (fn_modelo_ref_auto é BEFORE, sem conflito) + escreve em modelo_grades (tabela-filha, sem recursão).
CREATE OR REPLACE FUNCTION public.fn_modelo_grade_programada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.ordem_criacao_enviada IS TRUE
     AND OLD.ordem_criacao_enviada IS DISTINCT FROM NEW.ordem_criacao_enviada THEN
    UPDATE public.modelo_grades
       SET grades_programada = grades
     WHERE modelo_id = NEW.id
       AND grades_programada IS NULL;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_grade_programada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_modelo_grade_programada ON public.modelos;
CREATE TRIGGER trg_modelo_grade_programada
  AFTER UPDATE OF ordem_criacao_enviada ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_grade_programada();

-- ── Task 2: editar a Programada (a meta oficial) ───────────────────────────────────────────────────────────────────────
-- _grades = array [{variante_numero:int, grades:jsonb}]. Grava a Programada SÓ das variantes enviadas (estado por variante):
-- variante ausente do array NÃO é tocada nem apagada. Edição explícita: grava mesmo que a linha de modelo_grades tenha nascido
-- DEPOIS do envio da Ordem (grades_programada NULL até o próximo congelamento — nota M3 da Task 1). Variante sem linha em
-- modelo_grades = nada a gravar (a Programada mora na linha da grade; quem cria a linha é o Salvar do BOM).
CREATE OR REPLACE FUNCTION public._salvar_grade_programada_core(_modelo_id uuid, _grades jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF _grades IS NULL OR jsonb_typeof(_grades) <> 'array' THEN
    RAISE EXCEPTION 'grade_invalida: esperado uma lista' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_grades) AS e
     WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
        OR jsonb_typeof(e->'variante_numero') IS DISTINCT FROM 'number'
        OR jsonb_typeof(e->'grades') IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'grade_invalida: cada item precisa de variante_numero e grades' USING ERRCODE='P0001';
  END IF;
  UPDATE public.modelo_grades mg
     SET grades_programada = x.grades
    FROM jsonb_array_elements(_grades) AS e
         CROSS JOIN LATERAL (SELECT (e->>'variante_numero')::int AS vn, e->'grades' AS grades) x
   WHERE mg.modelo_id = _modelo_id AND mg.variante_numero = x.vn;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._salvar_grade_programada_core(uuid,jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_grade_programada(_modelo_id uuid, _grades jsonb, _rev_base integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_rev integer; v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Modulo criacao nao habilitado para esta loja' USING ERRCODE='42501'; END IF;
  PERFORM public._seg_exige_pagina('criacao_planejamento','criacao_desenvolvimento');
  SELECT m.tenant_id INTO v_tenant FROM public.modelos m
   WHERE m.id=_modelo_id AND (m.tenant_id=public.get_user_tenant_id() OR public.is_super_admin());
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE='P0002'; END IF;
  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id=_modelo_id FOR UPDATE;
  IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
    RAISE EXCEPTION 'conflito_versao: card' USING ERRCODE='P0409'; END IF;
  PERFORM public._salvar_grade_programada_core(_modelo_id, _grades);
  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id=_modelo_id;
  RETURN jsonb_build_object('modelo_id', _modelo_id, 'rev', v_rev);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.salvar_grade_programada(uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_grade_programada(uuid,jsonb,integer) TO authenticated, service_role;

-- ── Task 3: comparativo das 4 fases (leitura) ──────────────────────────────────────────────────────────────────────────
-- Casa Programada × CAD × PCP (cortada) × CQ por variante_numero × tamanho num OUTER-JOIN (união das variantes que aparecem
-- em QUALQUER fase; união dos tamanhos; célula ausente numa fase = null). As 4 fontes têm shapes diferentes:
--   PROGRAMADA: modelo_grades.grades_programada {tamanho:qtd}  (NULL = ainda não congelada)
--   CAD:        cad_grades.grades_planejadas    {tamanho:qtd}  (via o 1 CAD do modelo)
--   PCP:        producao_terceirizados.grade_detalhe {variante_tecido_id:{tamanho:{enviada,cortada,recebida,defeito}}}
--               chave = variante_tecido_id (uuid); TRADUÇÃO p/ variante_numero via cad_tecido_variantes.ordem (Tecido 1),
--               mesmo JOIN de _aplicar_reais_do_grade_detalhe. Bloco-fonte = o detalhado/ativo resolvido por
--               _resolver_fonte_confeccao (mesma regra da Grade Cortada; sem bloco-fonte = fase PCP vazia).
--   CQ:         cq_variantes {tamanho:qtd} por (variante_numero, etapa); recebida = etapa 'recebimento', defeito = 'defeito';
--               real da célula = max(0, recebida − defeito) (mesma fórmula de gradeRealCelula / grades_reais).
-- STABLE, SECURITY DEFINER, tenant-scoped (NÃO há portão de página — é leitura; devolve só o que o usuário já lê). anon sem EXECUTE.
CREATE OR REPLACE FUNCTION public.grade_comparativo(_modelo_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_tenant uuid;
  v_cad_id uuid;
  v_fonte uuid;
  v_gd jsonb;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nao autenticado'; END IF;
  SELECT m.tenant_id INTO v_tenant FROM public.modelos m
   WHERE m.id = _modelo_id AND (m.tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE='P0002'; END IF;

  -- 1 CAD por modelo (trigger enforce_unique_fk) — NULL quando o modelo ainda não tem CAD.
  SELECT c.id INTO v_cad_id FROM public.cad c WHERE c.modelo_id = _modelo_id LIMIT 1;

  -- Bloco-fonte de confecção (PCP cortada) e seu grade_detalhe.
  IF v_cad_id IS NOT NULL THEN
    v_fonte := public._resolver_fonte_confeccao(v_cad_id);
    IF v_fonte IS NOT NULL THEN
      SELECT COALESCE(pt.grade_detalhe, '{}'::jsonb) INTO v_gd
        FROM public.producao_terceirizados pt WHERE pt.id = v_fonte;
    END IF;
  END IF;
  v_gd := COALESCE(v_gd, '{}'::jsonb);

  WITH
  -- ordem (variante_numero) ↔ variante_tecido_id (chave da grade_detalhe), do Tecido 1 do CAD.
  vmap AS (
    SELECT ctv.ordem AS vn, ctv.variante_tecido_id::text AS vid
      FROM public.cad_tecidos ct
      JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
     WHERE v_cad_id IS NOT NULL AND ct.cad_id = v_cad_id AND ct.tipo='tecido' AND ct.numero=1
  ),
  -- PROGRAMADA: 1 célula por (variante_numero, tamanho).
  prog AS (
    SELECT mg.variante_numero AS vn, kv.key AS tam, (kv.value)::int AS qtd
      FROM public.modelo_grades mg
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(mg.grades_programada, '{}'::jsonb)) AS kv(key, value)
     WHERE mg.modelo_id = _modelo_id AND mg.grades_programada IS NOT NULL
  ),
  -- CAD: cad_grades.grades_planejadas.
  cadp AS (
    SELECT cg.variante_numero AS vn, kv.key AS tam, (kv.value)::int AS qtd
      FROM public.cad_grades cg
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(cg.grades_planejadas, '{}'::jsonb)) AS kv(key, value)
     WHERE v_cad_id IS NOT NULL AND cg.cad_id = v_cad_id
  ),
  -- PCP: grade_detalhe traduzido de variante_tecido_id -> variante_numero (via vmap).
  pcp AS (
    SELECT vm.vn AS vn, t.key AS tam,
           COALESCE((t.value->>'enviada')::int,0)  AS enviada,
           COALESCE((t.value->>'cortada')::int,0)  AS cortada,
           COALESCE((t.value->>'recebida')::int,0) AS recebida,
           COALESCE((t.value->>'defeito')::int,0)  AS defeito
      FROM vmap vm
      JOIN LATERAL jsonb_each(COALESCE(v_gd -> vm.vid, '{}'::jsonb)) AS t(key, value) ON true
  ),
  -- CQ: recebimento e defeito por (variante_numero, tamanho); real = max(0, rec - def).
  cq_rec AS (
    SELECT cv.variante_numero AS vn, kv.key AS tam, (kv.value)::int AS qtd
      FROM public.controle_qualidade cq
      JOIN public.cq_variantes cv ON cv.controle_qualidade_id = cq.id
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(cv.grades, '{}'::jsonb)) AS kv(key, value)
     WHERE v_cad_id IS NOT NULL AND cq.cad_id = v_cad_id AND cv.etapa = 'recebimento'
  ),
  cq_def AS (
    SELECT cv.variante_numero AS vn, kv.key AS tam, (kv.value)::int AS qtd
      FROM public.controle_qualidade cq
      JOIN public.cq_variantes cv ON cv.controle_qualidade_id = cq.id
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(cv.grades, '{}'::jsonb)) AS kv(key, value)
     WHERE v_cad_id IS NOT NULL AND cq.cad_id = v_cad_id AND cv.etapa = 'defeito'
  ),
  -- União das variantes (de qualquer fase) e o vid/label do Tecido 1.
  vn_union AS (
    SELECT vn FROM prog
    UNION SELECT vn FROM cadp
    UNION SELECT vn FROM pcp
    UNION SELECT vn FROM cq_rec
    UNION SELECT vn FROM cq_def
  ),
  variantes AS (
    SELECT u.vn,
           vm.vid,
           COALESCE(NULLIF(btrim(vt.nome_variante), ''),
                    NULLIF(btrim(vt.codigo_variante), ''),
                    'Variante ' || u.vn::text) AS label
      FROM vn_union u
      LEFT JOIN vmap vm ON vm.vn = u.vn
      LEFT JOIN public.variantes_tecido vt ON vt.id = vm.vid::uuid
     ORDER BY u.vn
  ),
  -- União dos tamanhos (de qualquer fase/variante).
  tam_union AS (
    SELECT tam FROM prog
    UNION SELECT tam FROM cadp
    UNION SELECT tam FROM pcp
    UNION SELECT tam FROM cq_rec
    UNION SELECT tam FROM cq_def
  ),
  tamanhos AS (
    -- Ordena pelo número antes do "|" quando houver (ex. "38|P"); size-key sem número (ex. "M", "UN")
    -- cai pro fim e desempata alfabético. O ::numeric só roda quando split_part casa com inteiro.
    SELECT tam FROM tam_union
     ORDER BY CASE WHEN split_part(tam, '|', 1) ~ '^[0-9]+$'
                   THEN split_part(tam, '|', 1)::numeric END NULLS LAST,
              tam
  ),
  -- Célula por (variante_numero, tamanho): só emite a chave se ALGUMA fase tem dado nela.
  grid AS (
    SELECT v.vn, t.tam
      FROM variantes v CROSS JOIN tamanhos t
  ),
  celulas AS (
    SELECT g.vn, g.tam,
      (SELECT qtd FROM prog p WHERE p.vn=g.vn AND p.tam=g.tam) AS prog_q,
      (SELECT qtd FROM cadp c WHERE c.vn=g.vn AND c.tam=g.tam) AS cad_q,
      (SELECT to_jsonb(pp) - 'vn' - 'tam' FROM pcp pp WHERE pp.vn=g.vn AND pp.tam=g.tam) AS pcp_j,
      (SELECT qtd FROM cq_rec r WHERE r.vn=g.vn AND r.tam=g.tam) AS cq_rec_q,
      (SELECT qtd FROM cq_def d WHERE d.vn=g.vn AND d.tam=g.tam) AS cq_def_q
    FROM grid g
  )
  SELECT jsonb_build_object(
    'variantes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                   'variante_numero', v.vn, 'variante_tecido_id', v.vid, 'label', v.label
                 ) ORDER BY v.vn) FROM variantes v), '[]'::jsonb),
    'tamanhos',  COALESCE((SELECT jsonb_agg(t.tam) FROM tamanhos t), '[]'::jsonb),
    'celulas',   COALESCE((SELECT jsonb_object_agg(
                   c.vn::text || '|' || c.tam,
                   jsonb_build_object(
                     'programada', c.prog_q,
                     'cad',        c.cad_q,
                     'pcp', CASE WHEN c.pcp_j IS NULL THEN NULL ELSE c.pcp_j END,
                     -- cq só materializa se a célula tem recebimento OU defeito; o lado ausente conta 0.
                     'cq',  CASE WHEN c.cq_rec_q IS NULL AND c.cq_def_q IS NULL THEN NULL
                                 ELSE jsonb_build_object(
                                   'recebida', COALESCE(c.cq_rec_q,0),
                                   'defeito',  COALESCE(c.cq_def_q,0),
                                   'real', GREATEST(0, COALESCE(c.cq_rec_q,0) - COALESCE(c.cq_def_q,0))
                                 ) END
                   )
                 ) FROM celulas c
                 WHERE c.prog_q IS NOT NULL OR c.cad_q IS NOT NULL OR c.pcp_j IS NOT NULL
                    OR c.cq_rec_q IS NOT NULL OR c.cq_def_q IS NOT NULL
                 ), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.grade_comparativo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grade_comparativo(uuid) TO authenticated, service_role;

-- ── Task 7: PRESERVAR grades_programada no Salvar do BOM (fix load-bearing) ─────────────────────────────────────────────
-- Guarda md5: redefine _salvar_modelo_bom_core SO se o corpo vivo for exatamente o esperado (senao PARA, sem mexer).
-- O Salvar do BOM faz DELETE+reinsert de modelo_grades e NAO preservava a coluna grades_programada (a meta oficial
-- congelada da F5-2): todo Salvar pos-Ordem ZERAVA a Programada. Fix (diff MINIMO): captura o mapa
-- variante_numero -> grades_programada ANTES do DELETE e reaplica no INSERT por variante. Nada mais muda.
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public._salvar_modelo_bom_core(uuid,jsonb,jsonb,jsonb,integer)'::regprocedure))
     <> '213e7fb3466e55469dd51029a2c9d1dd' THEN
    RAISE EXCEPTION 'Task 7: corpo vivo de _salvar_modelo_bom_core difere do esperado (md5 != 213e7fb3) - PARE';
  END IF;
END $guard$;

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
END;
$function$;
COMMIT;
