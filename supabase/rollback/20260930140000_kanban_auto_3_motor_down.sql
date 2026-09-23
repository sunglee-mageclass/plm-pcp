-- INVERSO de 20260930140000_kanban_auto_3_motor.sql — rodar depois do inverso 4 (ordem 4 → 3 → 2 → 1).
-- Derruba TODOS os gatilhos novos (inclusive os 3 statement-level por tabela-filha), as funções
-- novas do motor, e RECRIA as 4 funções redefinidas com o texto BYTE-A-BYTE do snapshot
-- /Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql:
--   fn_kanban_historico (:11976-11995) · _kanban_regredir_modelo (:3322-3403) ·
--   fn_modelo_ref_auto (:12141-12195) · _enviar_modelo_para_cad_core (:2150-2267).
-- Não toca dado de modelos. Se a chave foi ligada, restaurar ANTES as colunas
-- (kanban_previa_restauracao / kanban_restaurar), enquanto a migration 4 existe.
-- GUARDA DE ORDEM (fix round final): se a migration 4 ainda existe, RECUSA antes de tocar em qualquer
-- coisa (a txn aborta; nada é aplicado).

BEGIN;

DO $do$
BEGIN
  IF to_regprocedure('public.kanban_mover(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rode antes o inverso da migration 4 (20260930150000_kanban_auto_4_rpcs_down.sql).';
  END IF;
END
$do$;

-- 1) Gatilhos novos
DROP TRIGGER IF EXISTS trg_kanban_status_guard ON public.modelos;
DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.modelos;
DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.modelos;
DROP TRIGGER IF EXISTS trg_kanban_config ON public.tenant_config;
DROP TRIGGER IF EXISTS trg_kanban_chave_protegida ON public.tenant_config;
DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.categorias_terceirizado;
DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.categorias_terceirizado;
DO $do$
BEGIN
  -- a tabela some no inverso 1; rodar este inverso de novo depois dele não pode falhar
  IF to_regclass('public.kanban_recalculo_fila') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_kanban_processar_fila ON public.kanban_recalculo_fila;
  END IF;
END
$do$;
DO $do$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['modelo_tecidos', 'modelo_grades', 'modelo_aviamentos', 'modelo_servico_mo', 'cad',
                           'modelo_tecido_variantes', 'cad_tecidos', 'cad_aviamentos', 'cad_etiquetas',
                           'controle_qualidade', 'producao_terceirizados', 'cad_tecido_variantes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.%I', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.%I', t);
  END LOOP;
END
$do$;

-- 2) Funções novas do motor
DROP FUNCTION IF EXISTS public.fn_kanban_chave_protegida();
DROP FUNCTION IF EXISTS public.fn_kanban_status_guard();
DROP FUNCTION IF EXISTS public.fn_kanban_config();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_categoria();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_cad_tecido();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_modelo_tecido();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_cad();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_por_modelo();
DROP FUNCTION IF EXISTS public.fn_kanban_fila_modelo();
DROP FUNCTION IF EXISTS public.fn_kanban_processar_fila();
DROP FUNCTION IF EXISTS public._kanban_aplicar(uuid, uuid[], text, uuid);
DROP FUNCTION IF EXISTS public._kanban_enfileirar_tenant(uuid);
DROP FUNCTION IF EXISTS public._kanban_enfileirar(uuid[]);

-- 3) Funções redefinidas → texto do snapshot (CREATE OR REPLACE preserva o ACL de hoje)
CREATE OR REPLACE FUNCTION public.fn_kanban_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_desenvolvimento IS NOT NULL THEN
      INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
      VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, COALESCE(NEW.created_at, now()));
    END IF;
  ELSIF NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento
        AND NEW.status_desenvolvimento IS NOT NULL THEN
    INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at)
    VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, now());
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._kanban_regredir_modelo(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem text;
  v_status text;
  v_lancado boolean;
  v_cur_idx int;
  v_reqs jsonb;      -- tenant_config.kanban_requisitos
  v_exc jsonb;       -- tenant_config.kanban_requisitos_excecoes
  v_cond jsonb;      -- mapa condição→bool do modelo
  v_col record;
  v_acc text[] := '{}';   -- requisitos efetivos acumulados (cascata) até a coluna corrente
  v_k text;
  v_exc_col text[];
  v_alvo_idx int := null;
  v_alvo_key text := null;
  v_falhou boolean;
BEGIN
  SELECT m.tenant_id, coalesce(m.origem,'interno'), m.status_desenvolvimento, coalesce(m.lancado,false)
    INTO v_tenant, v_origem, v_status, v_lancado
    FROM public.modelos m WHERE m.id = _modelo_id;
  IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)
  IF v_origem IS DISTINCT FROM 'interno' THEN RETURN; END IF;  -- comprado: fluxo próprio, sem cascata
  IF v_lancado THEN RETURN; END IF;                        -- lançado: sai do fluxo; rebaixa é via CQ

  -- Config de requisitos por coluna (própria de cada etapa) + exceções.
  SELECT coalesce(kanban_requisitos, '{}'::jsonb), coalesce(kanban_requisitos_excecoes, '{}'::jsonb)
    INTO v_reqs, v_exc
    FROM public.tenant_config WHERE tenant_id = v_tenant;
  IF v_reqs IS NULL OR v_reqs = '{}'::jsonb THEN RETURN; END IF;  -- loja sem requisitos: nada a regredir

  -- Índice da coluna ATUAL do card na ordem do board (null → não está no board conhecido → sai).
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(v_tenant) r
    WHERE r.key = lower(btrim(coalesce(v_status,''))) ORDER BY r.ord LIMIT 1;
  IF v_cur_idx IS NULL THEN RETURN; END IF;

  -- Mapa de condições do modelo (mesma fonte da RPC de avaliação).
  v_cond := coalesce(public._avaliar_condicoes_kanban_core(v_tenant, ARRAY[_modelo_id]) -> _modelo_id::text, '{}'::jsonb);

  -- Caminha as colunas na ORDEM do board; acumula os requisitos efetivos (cascata) e acha a
  -- PRIMEIRA coluna cujos requisitos efetivos incluem alguma condição NÃO satisfeita.
  FOR v_col IN SELECT r.ord, r.key FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord LOOP
    -- soma os requisitos PRÓPRIOS desta coluna
    FOR v_k IN SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb)) LOOP
      IF NOT (v_k = ANY(v_acc)) THEN v_acc := array_append(v_acc, v_k); END IF;
    END LOOP;
    -- subtrai as EXCEÇÕES desta coluna (herdados que o admin desligou aqui) — igual ao TS:
    -- só remove o que NÃO é próprio desta coluna.
    SELECT array_agg(x) INTO v_exc_col
      FROM jsonb_array_elements_text(coalesce(v_exc -> v_col.key, '[]'::jsonb)) x
      WHERE NOT (x IN (SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb))));
    IF v_exc_col IS NOT NULL THEN
      v_acc := ARRAY(SELECT a FROM unnest(v_acc) a WHERE NOT (a = ANY(v_exc_col)));
    END IF;

    -- esta coluna falha se algum requisito efetivo NÃO está satisfeito no mapa de condições
    v_falhou := EXISTS (
      SELECT 1 FROM unnest(v_acc) req
      WHERE coalesce((v_cond ->> req)::boolean, false) = false
    );
    IF v_falhou THEN
      v_alvo_idx := v_col.ord;
      v_alvo_key := v_col.key;
      EXIT;  -- a PRIMEIRA que falha é o alvo (a mais atrás)
    END IF;
  END LOOP;

  -- Move só se: existe coluna que falha E o card está À FRENTE dela.
  IF v_alvo_idx IS NOT NULL AND v_cur_idx > v_alvo_idx THEN
    UPDATE public.modelos
      SET status_desenvolvimento = v_alvo_key,
          revisao_pendente = coalesce(revisao_pendente, '{}'::jsonb) || '{"kanban": true}'::jsonb
      WHERE id = _modelo_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean; v_relevante boolean; v_grupo_id uuid;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  v_revelar := public._ref_exibir_gate(NEW.tenant_id, NEW.status_desenvolvimento);

  SELECT c.nome, gp.nome, c.grupo_id INTO v_cat, v_grupo, v_grupo_id
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;

  v_sigla := public._ref_montar_sigla(NEW.tenant_id, 'interno', v_grupo_id, NEW.categoria_principal_id, NEW.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;

  IF NOT v_revelar THEN
    IF v_sigla <> '' THEN
      -- Número fixo na chegada: extrai o bloco final de dígitos do ref_auto atual, senão gera.
      IF coalesce(NEW.ref_auto,'') ~ '[0-9]+$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]+)$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
  ELSE
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$
;

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
$function$
;

COMMIT;

select pg_notify('pgrst', 'reload schema');
