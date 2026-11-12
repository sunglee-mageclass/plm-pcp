-- Volta da correcao board-vazio (20261127150000): devolve os 2 corpos de ANTES (md5 f4aa65dc / ce5b68b6).
-- So catalogo. Idempotente. BEGIN...COMMIT.
BEGIN;

CREATE OR REPLACE FUNCTION public._etapas_pl_derivar_lote(_tenant uuid, _ids uuid[], _cfg jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(modelo_id uuid, origem text, status_atual text, elegivel boolean, fluxo text[], reqs jsonb, exc jsonb, cond jsonb, derivavel boolean, entrada text, alvo text, resultado text, fixado boolean, primeira_falha text, faltando text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg   jsonb := coalesce(_cfg, public._etapas_pl_cfg(_tenant), '{}'::jsonb);
  v_fluxo text[];
  v_reqs  jsonb;
  v_ids   uuid[];
  v_cond  jsonb;
BEGIN
  -- board PL sob 'status_kanban' para a pura _kanban_fluxo (le status_kanban/revenda_kanban_colunas); _comprado=false.
  v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb)), false);
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
$function$

;
REVOKE EXECUTE ON FUNCTION public._etapas_pl_derivar_lote(uuid, uuid[], jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_etapas_pl_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg      jsonb;
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
  v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb)), false);
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
$function$

;
REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_status_guard() FROM PUBLIC, anon, authenticated;

COMMIT;
select pg_notify('pgrst', 'reload schema');
