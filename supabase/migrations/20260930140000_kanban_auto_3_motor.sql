-- Kanban automático — F1 · migration 3/4: MOTOR (histórico c/ janela, fila adiada, aplicar,
-- enfileiradores, gatilho da Config c/ snapshot, guard, gates por posição)
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 10–14, §3).
-- Inverso pareado: supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql.
--
-- CHAVE DESLIGADA (tenant_config.kanban_automatico=false, default) = comportamento IDÊNTICO ao
-- de hoje: `_kanban_enfileirar` não insere nada (JOIN na chave), o guard e o gatilho da Config
-- saem cedo, `_kanban_status_gate` devolve o status gravado e `_kanban_regredir_modelo` roda o
-- legado inteiro. A única diferença observável é o histórico ganhar `origem='manual'` + created_at
-- preciso (clock_timestamp) nas linhas novas.
--
-- GUC transação-local `app.kanban_sistema` ('' | auto | config | manual | restauracao) +
-- `app.kanban_lote` (uuid|''): marca quem está escrevendo o status. Enfileiradores NÃO
-- enfileiram com GUC não vazio (trava de recursão); guard deixa passar; o histórico grava a origem.
-- Quem seta o GUC SEMPRE restaura o valor anterior antes de sair.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- A) Histórico: origem + lote + colapso por JANELA de 10 s (só escritas 'auto')
--    Redefine fn_kanban_historico (snapshot funcoes.sql:11976-11995). `created_at` passa a ser
--    clock_timestamp() (desempate dentro da MESMA txn, onde now() é constante).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis    text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_s text := coalesce(current_setting('app.kanban_lote', true), '');
  v_origem text;
  v_lote   uuid;
  v_ult_id uuid;
  v_ult_or text;
  v_ult_em timestamptz;
  v_ult_st text;
  v_pen    text;
BEGIN
  v_origem := CASE WHEN v_sis IN ('auto', 'config', 'manual', 'restauracao') THEN v_sis ELSE 'manual' END;
  v_lote := CASE WHEN v_lote_s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN v_lote_s::uuid END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status_desenvolvimento IS NOT NULL THEN
      INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
      VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, COALESCE(NEW.created_at, now()),
              clock_timestamp(), v_origem, v_lote);
    END IF;
  ELSIF NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento
        AND NEW.status_desenvolvimento IS NOT NULL THEN
    IF v_origem IN ('auto', 'restauracao') THEN
      SELECT h.id, h.origem, h.entrou_at, h.status INTO v_ult_id, v_ult_or, v_ult_em, v_ult_st
        FROM public.modelo_kanban_historico h
       WHERE h.modelo_id = NEW.id
       ORDER BY h.entrou_at DESC, h.created_at DESC
       LIMIT 1;
    END IF;
    -- D14 (dono, 23/set): a restauração não repete a coluna que a última linha RESTANTE já tem
    -- (kanban_restaurar apaga antes as linhas auto/config do lote) — sem amostra extra no Leadtime.
    IF v_origem = 'restauracao' AND v_ult_id IS NOT NULL
       AND v_ult_st IS NOT DISTINCT FROM NEW.status_desenvolvimento THEN
      RETURN NEW;
    END IF;
    IF v_origem = 'auto' THEN
      IF v_ult_id IS NOT NULL AND v_ult_or = 'auto' AND v_ult_em > now() - interval '10 seconds' THEN
        SELECT h.status INTO v_pen
          FROM public.modelo_kanban_historico h
         WHERE h.modelo_id = NEW.id AND h.id <> v_ult_id
         ORDER BY h.entrou_at DESC, h.created_at DESC
         LIMIT 1;
        IF v_pen IS NOT DISTINCT FROM NEW.status_desenvolvimento THEN
          -- voltou à penúltima dentro da janela: o recuo/avanço transitório nunca existiu
          DELETE FROM public.modelo_kanban_historico WHERE id = v_ult_id;
        ELSE
          UPDATE public.modelo_kanban_historico
             SET status = NEW.status_desenvolvimento, entrou_at = now(),
                 created_at = clock_timestamp(), lote_id = v_lote
           WHERE id = v_ult_id;
        END IF;
        RETURN NEW;
      END IF;
    END IF;
    INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, now(), clock_timestamp(), v_origem, v_lote);
  END IF;
  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- B) Enfileirar (interno). Só entra na fila modelo DERIVÁVEL de loja com a CHAVE LIGADA, e só
--    com GUC vazio (escrita do próprio motor/RPCs não re-enfileira — trava de recursão).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_enfileirar(_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN; END IF;
  INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
    JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND tc.kanban_automatico
   WHERE m.id = ANY (_ids)
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
   ORDER BY m.id
  ON CONFLICT (modelo_id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_enfileirar_tenant(_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN; END IF;
  IF NOT public._kanban_ligado(_tenant) THEN RETURN; END IF;
  INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
   ORDER BY m.id
  ON CONFLICT (modelo_id) DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_enfileirar(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_enfileirar_tenant(uuid) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- C) Aplicar: deriva o lote e grava SÓ onde muda (UPDATE explícito), com GUC transação-local.
--    #Erro (revisao_pendente.kanban): NÃO é escrito aqui (decisão 14 do dono, 23/set) — com a
--    chave ligada, recuo automático só devolve o card à coluna a que ele pertence; um #Erro
--    legado (de quando a chave estava desligada) fica até o kanban_mover (D20).
--    REF: card FIXADO cuja posição derivada atinge ref_exibir_status tem a REF revelada aqui
--    (o status dele não muda, então fn_modelo_ref_auto não veria).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_cfg      jsonb;
  v_n        integer := 0;
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('auto', 'config') THEN
    RAISE EXCEPTION '_kanban_aplicar: origem inválida (%).', _origem USING ERRCODE = 'P0001';
  END IF;
  IF _tenant IS NULL OR NOT public._kanban_ligado(_tenant) THEN
    RETURN 0;
  END IF;

  v_cfg := public._kanban_cfg(_tenant);

  PERFORM set_config('app.kanban_sistema', _origem, true);
  PERFORM set_config('app.kanban_lote', coalesce(_lote::text, ''), true);

  WITH d AS (
    SELECT x.* FROM public._kanban_derivar_lote(_tenant, _ids, v_cfg) x WHERE x.derivavel
  ), calc AS (
    SELECT d.modelo_id AS mid,
           d.resultado,
           (d.resultado IS DISTINCT FROM d.status_atual) AS muda,
           (d.fixado AND public._ref_exibir_gate(_tenant, d.alvo)) AS revela_ref
      FROM d
  ), upd AS (
    UPDATE public.modelos m
       SET status_desenvolvimento = CASE WHEN c.muda THEN c.resultado ELSE m.status_desenvolvimento END,
           ref = CASE WHEN c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''
                      THEN m.ref_auto ELSE m.ref END
      FROM calc c
     WHERE m.id = c.mid
       AND m.tenant_id = _tenant
       AND (c.muda OR (c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''))
    RETURNING c.muda
  )
  SELECT count(*) FILTER (WHERE upd.muda) INTO v_n FROM upd;

  PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
  PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_aplicar(uuid, uuid[], text, uuid) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- D) Fila → processada no COMMIT (CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED).
--    O 1º evento da loja drena TODAS as linhas dela (1 chamada ao core por lote); os demais
--    eventos acham a fila vazia e saem. O DELETE fica FORA do bloco de exceção (a fila esvazia
--    mesmo se a derivação falhar); a falha vira WARNING e NUNCA derruba o COMMIT do usuário.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_processar_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  WITH d AS (
    DELETE FROM public.kanban_recalculo_fila f WHERE f.tenant_id = NEW.tenant_id RETURNING f.modelo_id
  )
  SELECT array_agg(d.modelo_id) INTO v_ids FROM d;
  IF v_ids IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public._kanban_aplicar(NEW.tenant_id, v_ids, 'auto', NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Kanban automático: recálculo ignorado (loja %, % card(s)): % [%]',
      NEW.tenant_id, cardinality(v_ids), SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_processar_fila ON public.kanban_recalculo_fila;
CREATE CONSTRAINT TRIGGER trg_kanban_processar_fila
  AFTER INSERT ON public.kanban_recalculo_fila
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_processar_fila();
COMMIT;

select pg_notify('pgrst', 'reload schema');
