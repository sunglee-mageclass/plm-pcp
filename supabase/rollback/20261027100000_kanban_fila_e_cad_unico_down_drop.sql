-- INVERSO (passo 2 de 2, OPCIONAL) de supabase/migrations/20261027100000_kanban_fila_e_cad_unico.sql (achados LEVES L3, fix
-- round 1, B5): DROP do gatilho trg_kanban_processar_fila_upd. SEPARADO do _down porque DROP TRIGGER, rodando como postgres,
-- pega AccessExclusive em ~23 tabelas auth/storage/realtime ate o COMMIT (supautils) - transacao curtissima, HORARIO CALMO.
-- Guarda: so roda depois do _down (fn_kanban_processar_fila com o texto de ANTES, f14d567a); senao P0001 e nada muda.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_kanban_processar_fila()'))) IS DISTINCT FROM 'f14d567a9c20f961b8be9cc497d21238' THEN
    RAISE EXCEPTION 'leves_l3 (volta drop): rode antes o 20261027100000_down (fn_kanban_processar_fila ainda com o texto da L3)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.kanban_recalculo_fila'::regclass AND t.tgname = 'trg_kanban_processar_fila_upd') THEN
    RAISE EXCEPTION 'leves_l3 (volta drop): trg_kanban_processar_fila_upd nao existe - nada a fazer' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DROP TRIGGER trg_kanban_processar_fila_upd ON public.kanban_recalculo_fila;

DO $pos$
BEGIN
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.kanban_recalculo_fila'::regclass AND t.tgname = 'trg_kanban_processar_fila') <> 1 THEN
    RAISE EXCEPTION 'leves_l3 (volta drop): o gatilho de INSERT da fila tinha de continuar' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
