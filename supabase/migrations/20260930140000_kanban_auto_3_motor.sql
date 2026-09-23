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
COMMIT;

select pg_notify('pgrst', 'reload schema');
