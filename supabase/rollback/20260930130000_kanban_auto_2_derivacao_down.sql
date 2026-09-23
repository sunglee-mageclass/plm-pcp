-- INVERSO de 20260930130000_kanban_auto_2_derivacao.sql — rodar depois do inverso 3 (ordem 4 → 3 → 2 → 1).
-- Recria `_kanban_status_rows` com o texto BYTE-A-BYTE do snapshot (funcoes.sql:3455-3503) ANTES de
-- derrubar `_kanban_status_rows_raw`, e derruba as funções novas de derivação. Não toca dado.
-- Pré-requisito: o inverso 3 já rodou (fn_modelo_ref_auto/_enviar_modelo_para_cad_core/
-- _kanban_regredir_modelo do snapshot não chamam `_kanban_status_gate`/`_kanban_ligado`).
-- GUARDA DE ORDEM (fix round final): se a migration 3 ainda existe, RECUSA antes de tocar em qualquer
-- coisa (a txn aborta; nada é aplicado).

BEGIN;

DO $do$
BEGIN
  IF to_regprocedure('public._kanban_aplicar(uuid,uuid[],text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rode antes o inverso da migration 3 (20260930140000_kanban_auto_3_motor_down.sql).';
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public._kanban_status_rows(_tenant uuid)
 RETURNS TABLE(ord integer, key text, lbl text)
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
$function$
;

DROP FUNCTION IF EXISTS public._kanban_status_gate(uuid, uuid, text);
DROP FUNCTION IF EXISTS public._kanban_derivar_lote(uuid, uuid[], jsonb);
DROP FUNCTION IF EXISTS public._kanban_ligado(uuid);
DROP FUNCTION IF EXISTS public._kanban_cfg(uuid);
DROP FUNCTION IF EXISTS public._kanban_fluxo(jsonb, boolean);
DROP FUNCTION IF EXISTS public._kanban_destino_drop_puro(text[], jsonb, jsonb, jsonb, text, boolean, text);
DROP FUNCTION IF EXISTS public._kanban_faltando_para(text[], jsonb, jsonb, jsonb, text, boolean, text);
DROP FUNCTION IF EXISTS public._kanban_derivar_puro(text[], jsonb, jsonb, jsonb, text, boolean);
DROP FUNCTION IF EXISTS public._kanban_req_efetivos(text, text[], jsonb, jsonb);
DROP FUNCTION IF EXISTS public._kanban_coluna_manual(text, jsonb);
DROP FUNCTION IF EXISTS public._kanban_lista(jsonb);
DROP FUNCTION IF EXISTS public._kanban_norm(text);
DROP FUNCTION IF EXISTS public._kanban_status_rows_raw(jsonb);

COMMIT;

select pg_notify('pgrst', 'reload schema');
