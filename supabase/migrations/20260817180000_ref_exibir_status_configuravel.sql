-- REF do modelo: etapa de exibição/revelação configurável por loja (ago/2026)
-- ============================================================================
-- Hoje a REF (invariante #11) é COPIADA de `ref_auto` → `ref` (e o campo aparece no
-- card) quando o modelo fica 'aprovado'. Este migration torna a ETAPA configurável,
-- espelhando o padrão do "Envio à Explosão" (`explosao_envio_status`, mig 20260817120000).
--
-- Chave nova: `tenant_config.ref_exibir_status` (text = KEY snake do status).
--   AUSENTE / '' ⇒ 'aprovado' (comportamento HISTÓRICO — nenhum tenant muda sem ação).
-- Semântica "A PARTIR da etapa": na etapa configurada OU em QUALQUER etapa POSTERIOR
--   (pela ORDEM das colunas do board da loja) a REF é revelada.
-- Órfã: etapa configurada saiu do board ⇒ fallback 'aprovado' (degrada com segurança).
--
-- MESMA RÉGUA nos dois lados: SQL `_ref_exibir_gate` (aqui, usado pelo trigger de REF) e
-- front `refCampoVisivel` (src/lib/kanban-status.ts, delega a `podeEnviarExplosao`) — que
-- gate a EXIBIÇÃO do campo no card. Reusa os helpers de board `_kanban_status_rows`
-- (mesmos de `_explosao_envio_gate`), portanto o slugify/resolve/ordem é o mesmo SSOT.
--
-- Invariante #11 preservada no resto: número fixo na chegada, sigla RE-SINCRONIZA,
-- REF manual (fora de `[A-Za-z]+[0-9]{8}`) NUNCA sobrescrita.
-- ============================================================================

BEGIN;

-- 1) Config (nullable, sem default → ausência = 'aprovado').
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS ref_exibir_status text;

-- 2) Gate booleano "atingiu a etapa de exibição" — ESPELHO EXATO da regra de
--    `_explosao_envio_gate`/`podeEnviarExplosao`, mas lendo `ref_exibir_status` e
--    devolvendo só o boolean (a REF não precisa de rótulo de mensagem).
CREATE OR REPLACE FUNCTION public._ref_exibir_gate(_tenant uuid, _status text)
RETURNS boolean
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
  SELECT ref_exibir_status INTO v_cfg FROM public.tenant_config WHERE tenant_id = _tenant;
  IF v_cfg IS NULL OR btrim(v_cfg) = '' THEN v_cfg := 'aprovado'; END IF;

  SELECT r.ord INTO v_cfg_idx
    FROM public._kanban_status_rows(_tenant) r WHERE r.key = v_cfg ORDER BY r.ord LIMIT 1;

  -- Órfã: etapa configurada sumiu do board → fallback 'aprovado'.
  IF v_cfg_idx IS NULL AND v_cfg <> 'aprovado' THEN
    v_cfg := 'aprovado';
    SELECT r.ord INTO v_cfg_idx
      FROM public._kanban_status_rows(_tenant) r WHERE r.key = 'aprovado' ORDER BY r.ord LIMIT 1;
  END IF;

  v_status := lower(btrim(coalesce(_status, '')));
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(_tenant) r WHERE r.key = v_status ORDER BY r.ord LIMIT 1;

  IF v_cfg_idx IS NULL THEN
    -- Board sem a etapa configurada E sem 'aprovado' → conservador: só igualdade exata.
    RETURN (v_status = v_cfg);
  ELSIF v_cur_idx IS NULL THEN
    -- Status do modelo fora do board (renomeado) → só igualdade exata.
    RETURN (v_status = v_cfg);
  ELSE
    RETURN (v_cur_idx >= v_cfg_idx);
  END IF;
END;
$function$;

-- 3) Trigger de REF: idêntico ao anterior (invariante #11), trocando APENAS o gatilho de
--    revelação de "status = 'aprovado'" para "atingiu a etapa configurada" (mesma régua).
CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean;
  v_relevante boolean;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;  -- só após chegar em Dev

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  -- Etapa de exibição configurável por loja (tenant_config.ref_exibir_status): a REF é
  -- revelada (ref_auto → ref) quando o modelo ATINGE a etapa configurada (ou posterior na
  -- ordem do board). Ausente ⇒ 'aprovado' (histórico). Órfã ⇒ fallback 'aprovado'.
  v_revelar := public._ref_exibir_gate(NEW.tenant_id, NEW.status_desenvolvimento);

  SELECT c.nome, gp.nome INTO v_cat, v_grupo
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;
  v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);

  IF NOT v_revelar THEN
    -- Antes da etapa: mantém ref_auto. Número fixo (chegada); sigla re-sincroniza.
    IF v_sigla <> '' THEN
      IF coalesce(NEW.ref_auto,'') ~ '^[A-Za-z]+[0-9]{8}$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]{8})$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := v_sigla || lpad(v_num::text, 8, '0');
    END IF;
  ELSE
    -- Atingiu a etapa: se ainda não há ref_auto, gera agora (grupo/cat/subcat já definidos).
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := v_sigla || lpad(v_num::text, 8, '0');
    END IF;
    -- Revela: copia ref_auto → ref (exibida) se ref estiver vazio (manual nunca sobrescreve).
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- 4) ACL do helper interno (invariante #9): REVOKE dos TRÊS (PUBLIC herda).
REVOKE EXECUTE ON FUNCTION public._ref_exibir_gate(uuid, text) FROM PUBLIC, anon, authenticated;

COMMIT;

select pg_notify('pgrst','reload schema');
