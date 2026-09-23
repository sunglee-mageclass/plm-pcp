-- Kanban automático — F1 · migration 2/4: DERIVAÇÃO (funções puras + leitura; nenhum gatilho)
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 7–9, §3).
-- Inverso pareado: supabase/rollback/20260930130000_kanban_auto_2_derivacao_down.sql.
--
-- ⚠️ ESPELHO EXATO de src/lib/kanban-auto.ts (statusDerivado/faltandoPara/destinoDrop/
-- fluxoDoModelo/boardDaLoja/statusParaGate). O anti-drift (tests/integration/kanban-auto.test.ts)
-- roda as MESMAS fixtures (tests/fixtures/kanban-auto-casos.ts) nos dois lados. Mudou aqui → muda lá.
-- Esta migration NÃO muda comportamento: só cria funções e troca o corpo de `_kanban_status_rows`
-- por uma delegação de saída IDÊNTICA (provado no teste com os boards reais das 6 lojas).
-- Invariante #9: toda função nova com EXECUTE revogado de PUBLIC/anon/authenticated.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- A) Normalização do board: corpo de `_kanban_status_rows` (20260817120000) EXTRAÍDO p/ jsonb.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_status_rows_raw(_raw jsonb)
 RETURNS TABLE(ord integer, key text, lbl text)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _raw IS NULL OR jsonb_typeof(_raw) <> 'array' OR jsonb_array_length(_raw) = 0 THEN
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
  FROM jsonb_array_elements(_raw) WITH ORDINALITY AS t(elem, ord)
  WHERE jsonb_typeof(t.elem) IN ('string', 'object');
END;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_status_rows(_tenant uuid)
 RETURNS TABLE(ord integer, key text, lbl text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Delegação (kanban automático, F1): MESMA saída de antes — a normalização mora em
  -- `_kanban_status_rows_raw(jsonb)`, reusada pelo motor com a config PROPOSTA (prévia).
  RETURN QUERY
  SELECT r.ord, r.key, r.lbl
    FROM public._kanban_status_rows_raw(
      (SELECT tc.status_kanban FROM public.tenant_config tc WHERE tc.tenant_id = _tenant)) r;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_status_rows_raw(jsonb) FROM PUBLIC, anon, authenticated;
COMMIT;

select pg_notify('pgrst', 'reload schema');
