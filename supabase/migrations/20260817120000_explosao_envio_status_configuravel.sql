-- Envio à Explosão configurável por loja (ago/2026)
-- ============================================================================
-- Torna CONFIGURÁVEL a etapa (coluna do kanban de Desenvolvimento) A PARTIR da qual
-- um modelo pode ser enviado à Explosão (materializa o CAD + `enviado_cad=true` via
-- `_enviar_modelo_para_cad_core`; rótulo atual do kanban "Enviado à Explosão").
--
-- Chave nova: `tenant_config.explosao_envio_status` (text = KEY snake do status).
--   AUSENTE / '' ⇒ 'aprovado' (comportamento HISTÓRICO — nenhum tenant muda sem ação).
-- Semântica: "a partir da etapa" — o modelo na etapa escolhida OU em QUALQUER etapa
--   POSTERIOR (pela ORDEM das colunas do board da loja) pode ser enviado.
-- Órfã: se a etapa configurada não existe mais no board (excluída/renomeada) ⇒
--   fallback 'aprovado' (degrada com segurança; o Config da Loja mostra a config órfã).
--
-- Enforcement nos DOIS lados: front (src/components/desenvolvimento/ModeloDetailPanel.tsx
-- via src/lib/kanban-status.ts `podeEnviarExplosao`) E servidor (aqui, no `_core`).
--
-- ⚠️ Os helpers `_kanban_slug`/`_kanban_resolve_key`/`_kanban_status_rows` ESPELHAM
-- `slugify`/`resolveStatusKey`/`normalizeKanbanStatuses` de src/lib/kanban-status.ts
-- (SSOT do front). Ao mexer em DEFAULT_STATUSES/slugify no TS, atualizar aqui também
-- (mesmo padrão de mirror SQL↔TS de `_norm3`/`splitMaiorResto`). O board historicamente
-- guarda LABELS (strings); `modelos.status_desenvolvimento` guarda a KEY resolvida.
-- ============================================================================

BEGIN;

-- 0) Limpeza idempotente de nomes 'pcp_*' (naming intermediário desta feature; renomeado
--    p/ 'explosao_*' a pedido do dono — a ação real é "Enviar à Explosão", não outro PCP).
--    IF EXISTS ⇒ no-op num banco limpo.
DROP FUNCTION IF EXISTS public._pcp_envio_gate(uuid, text);
ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS pcp_envio_status;

-- 1) Coluna de config (nullable, sem default → ausência = 'aprovado').
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS explosao_envio_status text;

-- 2) slugify (espelha `slugify` de kanban-status.ts): lower + strip acento PT-BR +
--    troca não-[a-z0-9] por '_' + trim '_'. Mantém DÍGITOS (ao contrário de _ref_norm).
CREATE OR REPLACE FUNCTION public._kanban_slug(_s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT btrim(
    regexp_replace(
      lower(translate(coalesce(_s, ''),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
        'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
      '[^a-z0-9]+', '_', 'g'),
    '_');
$function$;

-- 3) resolveStatusKey (espelha `resolveStatusKey`): chave canônica → volta igual;
--    label default → key especial (LABEL_TO_KEY); senão slugify.
CREATE OR REPLACE FUNCTION public._kanban_resolve_key(_label_or_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  WITH n AS (SELECT lower(btrim(coalesce(_label_or_key, ''))) AS norm)
  SELECT COALESCE(
    (SELECT c.k FROM (VALUES
      ('em_modelagem'), ('corte_piloto_1'), ('corte_piloto_2'), ('corte_piloto_3'),
      ('em_pilotagem'), ('prova_roupa_1'), ('prova_roupa_2'), ('prova_roupa_3'),
      ('prova_roupa_4'), ('prova_roupa_5'), ('em_ajuste'), ('stand_by'),
      ('reprovado'), ('aprovado')
    ) AS c(k), n WHERE c.k = n.norm),
    (SELECT m.k FROM (VALUES
      ('em modelagem', 'em_modelagem'),
      ('corte de piloto i', 'corte_piloto_1'),
      ('corte de piloto ii', 'corte_piloto_2'),
      ('corte de piloto iii', 'corte_piloto_3'),
      ('em pilotagem', 'em_pilotagem'),
      ('prova de roupa i', 'prova_roupa_1'),
      ('prova de roupa ii', 'prova_roupa_2'),
      ('prova de roupa iii', 'prova_roupa_3'),
      ('prova de roupa iv', 'prova_roupa_4'),
      ('prova de roupa v', 'prova_roupa_5'),
      ('em ajuste', 'em_ajuste'),
      ('stand by', 'stand_by'),
      ('reprovado', 'reprovado'),
      ('aprovado', 'aprovado')
    ) AS m(lbl, k), n WHERE m.lbl = n.norm),
    public._kanban_slug(_label_or_key)
  );
$function$;

-- 4) Board da loja resolvido para (ordem, key, label). Espelha `normalizeKanbanStatuses`:
--    board vazio/nulo → DEFAULT_STATUSES; strings → resolve; objetos → key||...||resolve(label).
CREATE OR REPLACE FUNCTION public._kanban_status_rows(_tenant uuid)
RETURNS TABLE(ord int, key text, lbl text)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_raw jsonb;
BEGIN
  SELECT status_kanban INTO v_raw FROM public.tenant_config WHERE tenant_id = _tenant;

  IF v_raw IS NULL OR jsonb_typeof(v_raw) <> 'array' OR jsonb_array_length(v_raw) = 0 THEN
    RETURN QUERY SELECT g.o, g.k, g.l FROM (VALUES
      (1, 'em_modelagem', 'Em Modelagem'),
      (2, 'corte_piloto_1', 'Corte de Piloto I'),
      (3, 'corte_piloto_2', 'Corte de Piloto II'),
      (4, 'corte_piloto_3', 'Corte de Piloto III'),
      (5, 'em_pilotagem', 'Em Pilotagem'),
      (6, 'prova_roupa_1', 'Prova de Roupa I'),
      (7, 'prova_roupa_2', 'Prova de Roupa II'),
      (8, 'prova_roupa_3', 'Prova de Roupa III'),
      (9, 'prova_roupa_4', 'Prova de Roupa IV'),
      (10, 'prova_roupa_5', 'Prova de Roupa V'),
      (11, 'em_ajuste', 'Em Ajuste'),
      (12, 'stand_by', 'Stand By'),
      (13, 'reprovado', 'Reprovado'),
      (14, 'aprovado', 'Aprovado')
    ) AS g(o, k, l);
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.ord::int,
    CASE
      WHEN jsonb_typeof(t.elem) = 'string'
        THEN public._kanban_resolve_key(t.elem #>> '{}')
      ELSE COALESCE(
        t.elem->>'key', t.elem->>'id', t.elem->>'value', t.elem->>'slug',
        public._kanban_resolve_key(COALESCE(t.elem->>'label', t.elem->>'nome', t.elem->>'name', '')))
    END,
    CASE
      WHEN jsonb_typeof(t.elem) = 'string'
        THEN t.elem #>> '{}'
      ELSE COALESCE(t.elem->>'label', t.elem->>'nome', t.elem->>'name', t.elem->>'key', '')
    END
  FROM jsonb_array_elements(v_raw) WITH ORDINALITY AS t(elem, ord)
  WHERE jsonb_typeof(t.elem) IN ('string', 'object');
END;
$function$;

-- 5) Gate: dado o tenant + status atual do modelo, resolve etapa exigida (com fallback
--    órfã), sua posição e a do modelo, e devolve ok/req_key/req_label.
--    ESPELHO EXATO de `podeEnviarExplosao` (src/lib/kanban-status.ts).
CREATE OR REPLACE FUNCTION public._explosao_envio_gate(
  _tenant uuid,
  _status text,
  OUT ok boolean,
  OUT req_key text,
  OUT req_label text
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg text;
  v_cfg_idx int;
  v_cur_idx int;
  v_status text;
BEGIN
  SELECT explosao_envio_status INTO v_cfg FROM public.tenant_config WHERE tenant_id = _tenant;
  IF v_cfg IS NULL OR btrim(v_cfg) = '' THEN v_cfg := 'aprovado'; END IF;

  SELECT r.ord, r.lbl INTO v_cfg_idx, req_label
    FROM public._kanban_status_rows(_tenant) r WHERE r.key = v_cfg ORDER BY r.ord LIMIT 1;

  -- Órfã: etapa configurada sumiu do board → fallback 'aprovado'.
  IF v_cfg_idx IS NULL AND v_cfg <> 'aprovado' THEN
    v_cfg := 'aprovado';
    SELECT r.ord, r.lbl INTO v_cfg_idx, req_label
      FROM public._kanban_status_rows(_tenant) r WHERE r.key = 'aprovado' ORDER BY r.ord LIMIT 1;
  END IF;

  req_key := v_cfg;
  IF req_label IS NULL OR btrim(req_label) = '' THEN
    req_label := initcap(replace(v_cfg, '_', ' '));
  END IF;

  v_status := lower(btrim(coalesce(_status, '')));
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(_tenant) r WHERE r.key = v_status ORDER BY r.ord LIMIT 1;

  IF v_cfg_idx IS NULL THEN
    -- Board sem a etapa configurada E sem 'aprovado' → conservador: só igualdade exata.
    ok := (v_status = v_cfg);
  ELSIF v_cur_idx IS NULL THEN
    -- Status do modelo fora do board (renomeado) → só igualdade exata com a etapa exigida.
    ok := (v_status = v_cfg);
  ELSE
    ok := (v_cur_idx >= v_cfg_idx);
  END IF;
END;
$function$;

-- 6) Enforcement no `_core`: adiciona o gate ANTES de materializar o CAD.
--    (Resto da função inalterado — cópia idempotente do BOM → CAD.)
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

-- 7) ACLs dos helpers internos (invariante #9): REVOKE dos TRÊS (PUBLIC herda).
REVOKE EXECUTE ON FUNCTION public._kanban_slug(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_resolve_key(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_status_rows(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._explosao_envio_gate(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;
