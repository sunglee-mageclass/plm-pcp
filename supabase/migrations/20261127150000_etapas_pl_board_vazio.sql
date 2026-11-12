-- Kanban PL (Onda 2) - correcao: board PL vazio = INERCIA mesmo com a chave LIGADA.
-- ADITIVA, so catalogo (2 CREATE OR REPLACE). BEGIN...COMMIT. Idempotente.
--
-- MOTIVO (achado MÉDIO da revisao da Task 8): _kanban_fluxo(jsonb_build_object('status_kanban','[]')) NAO
-- devolve vazio - a pura cai no board PADRAO do Dev (14 colunas, em_modelagem..aprovado). O gate de ligar
-- (etapas_pl_definir_automatico) recusa board vazio, mas um admin que ESVAZIA o board com a chave JA ligada
-- faria o proximo recalculo jogar os cards PL em colunas do Dev. A correcao trata o board cru vazio/nao-array
-- como fluxo VAZIO nos DOIS pontos que montam o fluxo do zero: _etapas_pl_derivar_lote (Task 1, usado pelo
-- aplicador/processador e pelo etapas_pl_mover) e fn_etapas_pl_status_guard (Task 6). Fluxo vazio =>
-- _kanban_derivar_puro nao avanca nada e o guard sai cedo (cardinality=0). Inerte hoje (chave off).
--
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261127150000_etapas_pl_board_vazio.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. So catalogo (CREATE OR REPLACE): nao prende tabela.
-- Volta: supabase/rollback/20261127150000_etapas_pl_board_vazio_down.sql (devolve os 2 corpos de antes).

BEGIN;

-- Guarda md5 ANTES (os corpos que esta correcao substitui).
DO $pre$
DECLARE
  v_der text := md5(pg_get_functiondef('public._etapas_pl_derivar_lote(uuid,uuid[],jsonb)'::regprocedure));
  v_gua text := md5(pg_get_functiondef('public.fn_etapas_pl_status_guard()'::regprocedure));
BEGIN
  IF v_der <> 'f4aa65dc141b082b120653c9ff82e008' THEN
    RAISE EXCEPTION 'etapas_pl_board_vazio: _etapas_pl_derivar_lote divergente (md5 %), esperado f4aa65dc141b082b120653c9ff82e008', v_der;
  END IF;
  IF v_gua <> 'ce5b68b683a89e824ba8dc29a670c14b' THEN
    RAISE EXCEPTION 'etapas_pl_board_vazio: fn_etapas_pl_status_guard divergente (md5 %), esperado ce5b68b683a89e824ba8dc29a670c14b', v_gua;
  END IF;
END
$pre$;

-- ── 1) _etapas_pl_derivar_lote: fluxo vazio quando o board cru nao e array nao-vazio ────────────────────
CREATE OR REPLACE FUNCTION public._etapas_pl_derivar_lote(_tenant uuid, _ids uuid[], _cfg jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(modelo_id uuid, origem text, status_atual text, elegivel boolean, fluxo text[], reqs jsonb, exc jsonb, cond jsonb, derivavel boolean, entrada text, alvo text, resultado text, fixado boolean, primeira_falha text, faltando text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg   jsonb := coalesce(_cfg, public._etapas_pl_cfg(_tenant), '{}'::jsonb);
  v_board jsonb := coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb);
  v_fluxo text[];
  v_reqs  jsonb;
  v_ids   uuid[];
  v_cond  jsonb;
BEGIN
  -- board PL cru vazio/nao-array => fluxo VAZIO (NAO cai no board padrao do Dev, que _kanban_fluxo devolveria).
  IF jsonb_typeof(v_board) <> 'array' OR jsonb_array_length(v_board) = 0 THEN
    v_fluxo := '{}'::text[];
  ELSE
    v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', v_board), false);
  END IF;
  v_reqs  := coalesce(v_cfg -> 'etapas_pl_requisitos', '{}'::jsonb);

  SELECT array_agg(m.id) INTO v_ids
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND (_ids IS NULL OR m.id = ANY (_ids))
     AND m.status_etapa_pl IS NOT NULL;
  v_cond := CASE WHEN v_ids IS NULL THEN '{}'::jsonb
                 ELSE coalesce(public._avaliar_condicoes_etapas_pl_core(_tenant, v_ids), '{}'::jsonb) END;

  RETURN QUERY
  WITH base AS (
    SELECT m.id AS mid,
           coalesce(m.origem, 'interno') AS org,
           m.status_etapa_pl::text AS st,
           (m.status_etapa_pl IS NOT NULL) AS eleg
      FROM public.modelos m
     WHERE m.tenant_id = _tenant
       AND (_ids IS NULL OR m.id = ANY (_ids))
  ), ent AS (
    SELECT b.*,
           v_fluxo AS fl,
           v_reqs  AS rq,
           '{}'::jsonb AS ex,
           coalesce(v_cond -> b.mid::text, '{}'::jsonb) AS cd
      FROM base b
  )
  SELECT e.mid, e.org, e.st, e.eleg, e.fl, e.rq, e.ex, e.cd,
         (x.d ->> 'derivavel')::boolean, x.d ->> 'entrada', x.d ->> 'alvo', x.d ->> 'resultado',
         (x.d ->> 'fixado')::boolean, x.d ->> 'primeiraFalha',
         ARRAY(SELECT f.v FROM jsonb_array_elements_text(x.d -> 'faltando') WITH ORDINALITY AS f(v, o) ORDER BY f.o)
    FROM ent e
    CROSS JOIN LATERAL (SELECT public._kanban_derivar_puro(e.fl, e.rq, e.ex, e.cd, e.st, e.eleg) AS d OFFSET 0) x;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._etapas_pl_derivar_lote(uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;

-- ── 2) fn_etapas_pl_status_guard: mesma guarda de board cru vazio ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg      jsonb;
  v_board    jsonb;
  v_fluxo    text[];
  v_reqs     jsonb;
  v_para     text;
  v_atual    text;
  v_cond     jsonb;
BEGIN
  IF NEW.status_etapa_pl IS NOT DISTINCT FROM OLD.status_etapa_pl THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NEW; END IF;
  IF NOT public._etapas_pl_ligado(NEW.tenant_id) THEN RETURN NEW; END IF;
  -- fora do PL (entrando OU saindo): elegivel = status_etapa_pl IS NOT NULL (Task 1); nao ha o que guardar.
  IF OLD.status_etapa_pl IS NULL OR NEW.status_etapa_pl IS NULL THEN RETURN NEW; END IF;

  v_cfg   := coalesce(public._etapas_pl_cfg(NEW.tenant_id), '{}'::jsonb);
  v_board := coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb);
  -- board cru vazio/nao-array => fluxo VAZIO (nao cai no board do Dev); sem fluxo, nada a guardar.
  IF jsonb_typeof(v_board) <> 'array' OR jsonb_array_length(v_board) = 0 THEN
    v_fluxo := '{}'::text[];
  ELSE
    v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', v_board), false);
  END IF;
  IF cardinality(v_fluxo) = 0 THEN RETURN NEW; END IF;
  v_reqs  := coalesce(v_cfg -> 'etapas_pl_requisitos', '{}'::jsonb);

  PERFORM public._etapas_pl_enfileirar(ARRAY[NEW.id]);

  v_para := public._kanban_norm(NEW.status_etapa_pl);
  IF v_para = '' THEN
    NEW.status_etapa_pl := OLD.status_etapa_pl;
    RETURN NEW;
  END IF;
  IF NOT (v_para = ANY (v_fluxo)) THEN
    RAISE EXCEPTION 'etapas_pl_fora_do_fluxo: %', NEW.status_etapa_pl USING ERRCODE = 'P0001';
  END IF;
  IF v_para = v_fluxo[1] OR public._kanban_coluna_manual(v_para, v_reqs) THEN
    RETURN NEW;
  END IF;

  v_atual := public._kanban_norm(OLD.status_etapa_pl);
  IF v_atual <> '' AND v_atual = ANY (v_fluxo) AND v_atual <> v_fluxo[1]
     AND public._kanban_coluna_manual(v_atual, v_reqs) THEN
    v_cond := coalesce(public._avaliar_condicoes_etapas_pl_core(NEW.tenant_id, ARRAY[NEW.id]) -> NEW.id::text, '{}'::jsonb);
    NEW.status_etapa_pl :=
      public._kanban_derivar_puro(v_fluxo, v_reqs, '{}'::jsonb, v_cond, OLD.status_etapa_pl, true) ->> 'alvo';
  ELSE
    NEW.status_etapa_pl := OLD.status_etapa_pl;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_status_guard() FROM PUBLIC, anon, authenticated;

COMMIT;

select pg_notify('pgrst', 'reload schema');
