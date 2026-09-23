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

-- ────────────────────────────────────────────────────────────────────────────
-- B) Helpers PUROS (IMMUTABLE, sem tabela) — espelho linha a linha de kanban-auto.ts
-- ────────────────────────────────────────────────────────────────────────────

-- ≡ normKey (TS): lower(btrim(coalesce(x,''))). Nota: btrim só tira ESPAÇO; o `trim()` do JS tira
-- também \t\n — divergência aceita (chaves/labels reais não têm tab/quebra).
CREATE OR REPLACE FUNCTION public._kanban_norm(_s text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT lower(btrim(coalesce(_s, '')));
$function$;

-- ≡ mapaListas/lerRevendaConfig (TS): array jsonb → text[] só com os elementos STRING, na ordem.
-- Qualquer outra coisa (null, objeto, número) → '{}'.
CREATE OR REPLACE FUNCTION public._kanban_lista(_j jsonb)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT coalesce(array_agg(t.e #>> '{}' ORDER BY t.o), '{}'::text[])
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_j) = 'array' THEN _j ELSE '[]'::jsonb END)
         WITH ORDINALITY AS t(e, o)
   WHERE jsonb_typeof(t.e) = 'string';
$function$;

-- ≡ colunaManual (TS): sem requisito PRÓPRIO = manual; 'reprovado' SEMPRE manual (regra fixa).
CREATE OR REPLACE FUNCTION public._kanban_coluna_manual(_col text, _reqs jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT v.k = 'reprovado'
      OR cardinality(public._kanban_lista(
           CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs -> v.k END)) = 0
    FROM (SELECT public._kanban_norm(_col) AS k) v;
$function$;

-- ≡ requisitosEfetivos (src/lib/kanban-condicoes.ts): UNIÃO (dedup, ordem de aparição) dos
-- requisitos PRÓPRIOS de fluxo[1..idx(col)] MENOS as exceções da própria coluna que não são
-- próprias dela. `_col` fora do fluxo → só os próprios (sem exceção).
CREATE OR REPLACE FUNCTION public._kanban_req_efetivos(_col text, _fluxo text[], _reqs jsonb, _exc jsonb)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_reqs     jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_exc_obj  jsonb  := CASE WHEN jsonb_typeof(_exc) = 'object' THEN _exc ELSE '{}'::jsonb END;
  v_idx      int    := array_position(coalesce(_fluxo, '{}'::text[]), _col);
  v_proprios text[] := public._kanban_lista(v_reqs -> _col);
  v_acc      text[] := '{}'::text[];
  v_k        text;
  v_i        int;
BEGIN
  IF v_idx IS NULL THEN
    FOREACH v_k IN ARRAY v_proprios LOOP
      IF NOT (v_k = ANY (v_acc)) THEN v_acc := v_acc || v_k; END IF;
    END LOOP;
    RETURN v_acc;
  END IF;
  FOR v_i IN 1..v_idx LOOP
    FOREACH v_k IN ARRAY public._kanban_lista(v_reqs -> _fluxo[v_i]) LOOP
      IF NOT (v_k = ANY (v_acc)) THEN v_acc := v_acc || v_k; END IF;
    END LOOP;
  END LOOP;
  FOREACH v_k IN ARRAY public._kanban_lista(v_exc_obj -> _col) LOOP
    IF NOT (v_k = ANY (v_proprios)) THEN v_acc := array_remove(v_acc, v_k); END IF;
  END LOOP;
  RETURN v_acc;
END;
$function$;

-- ≡ statusDerivado (TS). Devolve jsonb com as MESMAS chaves do tipo `Derivacao`
-- ({derivavel, entrada, alvo, resultado, fixado, primeiraFalha, faltando}) → o anti-drift compara
-- com `toEqual` direto. Caminha as colunas AUTOMÁTICAS na ordem e PARA na 1ª que falha (nunca pula
-- etapa — G-inicial #3); entrada = fluxo[1] = piso; fixado = coluna manual ≠ entrada.
CREATE OR REPLACE FUNCTION public._kanban_derivar_puro(
  _fluxo text[], _reqs jsonb, _exc jsonb, _cond jsonb, _status text, _derivavel boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_fluxo    text[] := coalesce(_fluxo, '{}'::text[]);
  v_reqs_in  jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_reqs     jsonb;
  v_st       text   := public._kanban_norm(_status);
  v_entrada  text;
  v_alvo     text;
  v_primeira text   := NULL;
  v_faltando text[] := '{}'::text[];
  v_col      text;
  v_fixado   boolean;
BEGIN
  IF cardinality(v_fluxo) = 0 OR NOT coalesce(_derivavel, false) THEN
    RETURN jsonb_build_object(
      'derivavel', false, 'entrada', v_fluxo[1], 'alvo', NULL, 'resultado', _status,
      'fixado', false, 'primeiraFalha', NULL, 'faltando', '[]'::jsonb);
  END IF;

  v_reqs    := v_reqs_in - 'reprovado';            -- semReprovado
  v_entrada := v_fluxo[1];
  v_alvo    := v_entrada;
  FOREACH v_col IN ARRAY v_fluxo LOOP
    CONTINUE WHEN public._kanban_coluna_manual(v_col, v_reqs_in);
    v_faltando := ARRAY(
      SELECT e.k
        FROM unnest(public._kanban_req_efetivos(v_col, v_fluxo, v_reqs, _exc)) WITH ORDINALITY AS e(k, o)
       WHERE NOT coalesce((_cond -> e.k) = 'true'::jsonb, false)
       ORDER BY e.o);
    IF cardinality(v_faltando) > 0 THEN
      v_primeira := v_col;
      EXIT;
    END IF;
    v_alvo := v_col;
  END LOOP;
  IF v_primeira IS NULL THEN v_faltando := '{}'::text[]; END IF;

  v_fixado := v_st <> '' AND v_st = ANY (v_fluxo) AND v_st <> v_entrada
              AND public._kanban_coluna_manual(v_st, v_reqs_in);
  RETURN jsonb_build_object(
    'derivavel', true, 'entrada', v_entrada, 'alvo', v_alvo,
    'resultado', CASE WHEN v_fixado THEN v_st ELSE v_alvo END,
    'fixado', v_fixado, 'primeiraFalha', v_primeira, 'faltando', to_jsonb(v_faltando));
END;
$function$;

-- ≡ faltandoPara (TS): união (dedup, em ordem) dos efetivos NÃO satisfeitos das colunas
-- AUTOMÁTICAS de primeiraFalha até `_para` (inclusive).
CREATE OR REPLACE FUNCTION public._kanban_faltando_para(
  _fluxo text[], _reqs jsonb, _exc jsonb, _cond jsonb, _status text, _derivavel boolean, _para text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_fluxo   text[] := coalesce(_fluxo, '{}'::text[]);
  v_reqs_in jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_reqs    jsonb  := v_reqs_in - 'reprovado';
  v_d       jsonb  := public._kanban_derivar_puro(_fluxo, _reqs, _exc, _cond, _status, _derivavel);
  v_ini     int;
  v_fim     int;
  v_out     text[] := '{}'::text[];
  v_k       text;
  v_i       int;
BEGIN
  IF NOT (v_d ->> 'derivavel')::boolean OR (v_d ->> 'primeiraFalha') IS NULL THEN
    RETURN v_out;
  END IF;
  v_ini := array_position(v_fluxo, v_d ->> 'primeiraFalha');
  v_fim := array_position(v_fluxo, public._kanban_norm(_para));
  IF v_ini IS NULL OR v_fim IS NULL OR v_fim < v_ini THEN
    RETURN v_out;
  END IF;
  FOR v_i IN v_ini..v_fim LOOP
    CONTINUE WHEN public._kanban_coluna_manual(v_fluxo[v_i], v_reqs_in);
    FOREACH v_k IN ARRAY public._kanban_req_efetivos(v_fluxo[v_i], v_fluxo, v_reqs, _exc) LOOP
      IF NOT coalesce((_cond -> v_k) = 'true'::jsonb, false) AND NOT (v_k = ANY (v_out)) THEN
        v_out := v_out || v_k;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- ≡ destinoDrop (TS) — tabela ÚNICA de arraste do §3, na MESMA ordem de avaliação.
-- Devolve {acao, status, faltando} com as chaves do tipo `DestinoDrop`.
CREATE OR REPLACE FUNCTION public._kanban_destino_drop_puro(
  _fluxo text[], _reqs jsonb, _exc jsonb, _cond jsonb, _status text, _derivavel boolean, _para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_fluxo    text[] := coalesce(_fluxo, '{}'::text[]);
  v_reqs_in  jsonb  := CASE WHEN jsonb_typeof(_reqs) = 'object' THEN _reqs ELSE '{}'::jsonb END;
  v_p        text   := public._kanban_norm(_para);
  v_st       text   := public._kanban_norm(_status);
  v_idx_para int    := array_position(v_fluxo, public._kanban_norm(_para));
  v_d        jsonb;
  v_alvo     text;
  v_idx_alvo int;
  v_fixado   boolean;
BEGIN
  -- 1. fora do fluxo
  IF v_idx_para IS NULL THEN
    RETURN jsonb_build_object('acao', 'fora_do_fluxo', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  v_d := public._kanban_derivar_puro(_fluxo, _reqs, _exc, _cond, _status, _derivavel);
  -- 2. não derivável: gravação livre
  IF NOT (v_d ->> 'derivavel')::boolean THEN
    IF v_p = v_st THEN
      RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'fixar', 'status', v_p, 'faltando', '[]'::jsonb);
  END IF;
  v_alvo     := v_d ->> 'alvo';
  v_idx_alvo := array_position(v_fluxo, v_alvo);
  v_fixado   := (v_d ->> 'fixado')::boolean;
  -- 3. entrada
  IF v_p = v_d ->> 'entrada' THEN
    IF v_fixado THEN
      RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
    END IF;
    IF v_idx_alvo = 1 THEN
      IF v_st = v_alvo THEN
        RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
      END IF;
      RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'bloquear_ja_cumprida', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  -- 4. coluna manual
  IF public._kanban_coluna_manual(v_p, v_reqs_in) THEN
    IF v_p = v_st THEN
      RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'fixar', 'status', v_p, 'faltando', '[]'::jsonb);
  END IF;
  -- 5. além da derivada
  IF v_idx_para > v_idx_alvo THEN
    RETURN jsonb_build_object('acao', 'bloquear_faltando', 'status', _status,
      'faltando', to_jsonb(public._kanban_faltando_para(_fluxo, _reqs, _exc, _cond, _status, _derivavel, v_p)));
  END IF;
  -- 6. aquém da derivada
  IF v_idx_para < v_idx_alvo THEN
    IF v_fixado THEN
      RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
    END IF;
    RETURN jsonb_build_object('acao', 'bloquear_ja_cumprida', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  -- 7. na própria derivada
  IF v_fixado THEN
    RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
  END IF;
  IF v_st = v_alvo THEN
    RETURN jsonb_build_object('acao', 'nada', 'status', _status, 'faltando', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('acao', 'soltar', 'status', v_alvo, 'faltando', '[]'::jsonb);
END;
$function$;

-- ≡ fluxoDoModelo/boardDaLoja (TS): board normalizado + DEDUP por key (fica a 1ª ocorrência);
-- comprado = board ∩ revenda_kanban_colunas ([] = todas), comparação EXATA de key.
CREATE OR REPLACE FUNCTION public._kanban_fluxo(_cfg jsonb, _comprado boolean)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
  WITH r AS (
    SELECT x.ord, x.key FROM public._kanban_status_rows_raw(_cfg -> 'status_kanban') x
  ), d AS (
    SELECT DISTINCT ON (r.key) r.key, r.ord FROM r ORDER BY r.key, r.ord
  ), p AS (
    SELECT public._kanban_lista(_cfg -> 'revenda_kanban_colunas') AS perm
  )
  SELECT coalesce(array_agg(d.key ORDER BY d.ord), '{}'::text[])
    FROM d, p
   WHERE NOT coalesce(_comprado, false) OR cardinality(p.perm) = 0 OR d.key = ANY (p.perm);
$function$;

-- Invariante #9 — internas sem EXECUTE p/ PUBLIC/anon/authenticated.
REVOKE EXECUTE ON FUNCTION public._kanban_norm(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_lista(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_coluna_manual(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_req_efetivos(text, text[], jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_derivar_puro(text[], jsonb, jsonb, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_faltando_para(text[], jsonb, jsonb, jsonb, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_destino_drop_puro(text[], jsonb, jsonb, jsonb, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_fluxo(jsonb, boolean) FROM PUBLIC, anon, authenticated;
COMMIT;

select pg_notify('pgrst', 'reload schema');
