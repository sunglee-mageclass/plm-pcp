-- Inverso de supabase/migrations/20261031120000_seg_s1_modelos_guarda.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção 03/out).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_modelo_preco_venda_gate()
--     ANTES  4eeb8baaaee829f0a44c643e3beb69fe
--     DEPOIS e89be53c25f421724994e78b756a027d
--   public._enviar_modelo_para_cad_core(uuid,text,text)
--     ANTES  14179bce7709643ea068edfed128ca43
--     DEPOIS bf28796bcd86538a3a5b516e9cf356c6
--   public.excluir_cad(uuid)
--     ANTES  4c1e576932ed160fdb0ec5ebec3d3a2c
--     DEPOIS a737f81cfd9c08abc8ac2a581aa88db4
--   public.voltar_modelo_desenvolvimento(uuid)
--     ANTES  3a43fa4204a4f429a6c878e63c2557eb
--     DEPOIS b5c893d56d4745b0a4e0938b20676ba7
--   public._salvar_cad_completo_core(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)
--     ANTES  8f1455c310792b91fd69c1d7b624a64e
--     DEPOIS de45e1c2d045648ebbb4a9b3a86bb7c7
--   public._pa_recomputar_precos_modelo(uuid)
--     ANTES  3f0c4d88da8e23a61ff9e3dda7817be2
--     DEPOIS 5ab86f9ef7abd8f11310da804aa6eb4b
--   public._imp_recomputar_precos_modelo(uuid)
--     ANTES  bbda77c40c515686a4307a563749b3dc
--     DEPOIS 1c525cb7ab309240c6fec182f59d58a8
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / REVOKE-GRANT EXECUTE / ALTER DEFAULT PRIVILEGES): nenhuma tabela de
-- negócio, nada de auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY. Idempotente (guarda aceita antes OU depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_modelo_preco_venda_gate()', '4eeb8baaaee829f0a44c643e3beb69fe', 'e89be53c25f421724994e78b756a027d'),
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', '14179bce7709643ea068edfed128ca43', 'bf28796bcd86538a3a5b516e9cf356c6'),
      ('public.excluir_cad(uuid)', '4c1e576932ed160fdb0ec5ebec3d3a2c', 'a737f81cfd9c08abc8ac2a581aa88db4'),
      ('public.voltar_modelo_desenvolvimento(uuid)', '3a43fa4204a4f429a6c878e63c2557eb', 'b5c893d56d4745b0a4e0938b20676ba7'),
      ('public._salvar_cad_completo_core(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)', '8f1455c310792b91fd69c1d7b624a64e', 'de45e1c2d045648ebbb4a9b3a86bb7c7'),
      ('public._pa_recomputar_precos_modelo(uuid)', '3f0c4d88da8e23a61ff9e3dda7817be2', '5ab86f9ef7abd8f11310da804aa6eb4b'),
      ('public._imp_recomputar_precos_modelo(uuid)', 'bbda77c40c515686a4307a563749b3dc', '1c525cb7ab309240c6fec182f59d58a8')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 's1_m2_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_modelo_preco_venda_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só morde para origem INTERNA (o preço de revenda/importado é derivado no servidor — o recompute
  -- definer muda `preco_venda` mas roda com o JWT de quem RECEBE a OC / salva markups, que não tem
  -- esta section). Origem comprada nunca é editável por cliente no card/Sheet (front já bloqueia).
  IF NEW.preco_venda IS DISTINCT FROM OLD.preco_venda
     AND COALESCE(NEW.origem, 'interno') NOT IN ('revenda', 'importado')
     AND NOT public.user_can_edit('criacao_planejamento:preco_venda') THEN
    RAISE EXCEPTION 'Sem permissão para editar o preço de venda'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;

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
  v_status text;
  v_status_plan text;
  v_status_gate text;
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

  -- leves L3 kanban #11: serializa envios do MESMO card. Mesma chave do enforce_unique_fk de cad.modelo_id (o INSERT abaixo
  -- pede de novo a mesma trava - reentrante na mesma transacao): o 2o envio simultaneo espera o 1o e, depois do COMMIT dele,
  -- acha o CAD e segue o caminho idempotente (antes: unique_violation "Ja existe registro em cad...").
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT status_desenvolvimento, status_planejamento INTO v_status, v_status_plan FROM public.modelos WHERE id = _modelo_id;
  v_status_gate := public._kanban_status_gate(v_tenant, _modelo_id, v_status);
  -- leves L3 (R14 msg reprovado, P-190 A): com a chave ligada, card em 'reprovado' nao tem posicao (gate NULL) - o motivo e o
  -- reprovado, nao a etapa. ASCII com prefixo (a tela traduz: src/lib/erro-mensagem.ts).
  -- [fix round 1, A1 / P-213 A] reprovado = Dev OU Planejamento; reprovado no PLANEJAMENTO nunca vai a Explosao (qualquer
  -- chave - o _kanban_status_gate da 20261027140000 tambem o tira da regua; aqui fica independente dela).
  IF public._kanban_norm(v_status_plan) = 'reprovado'
     OR (v_status_gate IS NULL AND public._kanban_norm(v_status) = 'reprovado') THEN
    RAISE EXCEPTION 'reprovado_explosao: Card reprovado nao vai a Explosao' USING ERRCODE = 'P0001';
  END IF;
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, v_status_gate) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id ORDER BY id LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.excluir_cad(_cad_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_modelo uuid; v_enviado boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  SELECT tenant_id, modelo_id, COALESCE(enviado_corte, false)
    INTO v_tenant, v_modelo, v_enviado FROM public.cad WHERE id = _cad_id;
  IF v_modelo IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF v_enviado THEN
    RAISE EXCEPTION 'Este CAD já foi enviado ao corte (baixou estoque). Reverta o corte antes de excluir.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.lancamentos WHERE cad_id = _cad_id) THEN
    RAISE EXCEPTION 'Este CAD tem lançamentos e não pode ser excluído.';
  END IF;
  DELETE FROM public.cad WHERE id = _cad_id;  -- rascunho (sem corte): cascatas internas ok
  UPDATE public.modelos SET enviado_cad = false WHERE id = v_modelo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.voltar_modelo_desenvolvimento(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo criação não habilitado' using errcode = '42501';
  end if;

  -- Verifica que o modelo pertence ao tenant do usuário (ou é super_admin).
  if not exists (
    select 1 from public.modelos
    where id = _modelo_id
      and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'Modelo não encontrado' using errcode = 'P0002';
  end if;

  update public.modelos
    set enviado_cad = false
  where id = _modelo_id;
end;
$function$;

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
    INSERT INTO public.cad (modelo_id, status_corte)
    VALUES (_modelo_id, 'pendente')
    RETURNING id INTO v_cad_id;
  END IF;

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

  RETURN v_cad_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_insumos numeric := 0;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo,
         p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_valor_unitario, v_desconto_pct, v_markup_atacado, v_markup_varejo,
         v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_acabados p where p.id = _produto_id;

  if v_modelo_id is null then
    return; -- sem espelho no Planejamento ainda — nada a recomputar
  end if;

  -- [leves L8, preco M1] custo_previsto da linha JA e preco x consumo x (1 + perda) (por peca; = o que a ficha soma em
  -- totaisBom) -> soma direta, como _custo_unitario_modelos_core (CTE pa, R16) e _salvar_produto_acabado_core
  -- (insumos_total). Antes multiplicava o consumo de novo (consumo 2 contava o insumo 2x).
  select coalesce(sum(coalesce(me.custo_previsto, 0)), 0) into v_insumos
    from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;

  -- MO na base (mesma fonte modelo_servico_mo do card do Planejamento; BRL por peça).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := coalesce(v_valor_unitario, 0) * (1 - coalesce(v_desconto_pct, 0) / 100.0) + v_insumos + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  -- Preço FIXO manda; senão deriva do markup (base × markup); senão NULL (sem markup nem fixo = não há
  -- preço — NÃO manter o valor antigo, que vira lixo exibido como "fixado" que o usuário nunca digitou).
  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    -- [leves L8, preco B3] markup 0 (ou negativo, legado) = sem markup -> NULL, igual ao _imp_recomputar_precos_modelo
    -- (antes dava preco 0,00)
    when v_markup_atacado is not null and v_markup_atacado > 0 then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: base(custo) × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null and v_markup_varejo > 0 then round(v_custo * v_markup_varejo, 2)
    else null end;

  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then
    v_preco_venda := v_venda_atual;
  end if;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end;
$function$;

CREATE OR REPLACE FUNCTION public._imp_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.markup_atacado, p.markup_varejo, p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_markup_atacado, v_markup_varejo, v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_importados p where p.id = _produto_id;
  if v_modelo_id is null then
    return; -- sem espelho ainda
  end if;

  -- MO na base (mesma fonte modelo_servico_mo; BRL por peça — soma limpa ao landed, já em BRL).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := public._imp_custo_landed(_produto_id) + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null and v_markup_atacado > 0 then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: custo landed × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null and v_markup_varejo > 0 then round(v_custo * v_markup_varejo, 2)
    else null end;

  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then
    v_preco_venda := v_venda_atual;
  end if;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_modelo_preco_venda_gate()', '4eeb8baaaee829f0a44c643e3beb69fe'),
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', '14179bce7709643ea068edfed128ca43'),
      ('public.excluir_cad(uuid)', '4c1e576932ed160fdb0ec5ebec3d3a2c'),
      ('public.voltar_modelo_desenvolvimento(uuid)', '3a43fa4204a4f429a6c878e63c2557eb'),
      ('public._salvar_cad_completo_core(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)', '8f1455c310792b91fd69c1d7b624a64e'),
      ('public._pa_recomputar_precos_modelo(uuid)', '3f0c4d88da8e23a61ff9e3dda7817be2'),
      ('public._imp_recomputar_precos_modelo(uuid)', 'bbda77c40c515686a4307a563749b3dc')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's1_m2_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;
COMMIT;
