-- DROP opcional de supabase/migrations/20261103176000_urg_r3_estoque_mov_log.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- Rodar SO depois do 20261103176000_down (funcao no texto NEUTRO) e com o SITE ja voltado, em HORARIO CALMO: DROP TRIGGER pega
-- AccessExclusiveLock em public.cad_aviamentos e public.cad_etiquetas E, pelo supautils, prende 23 tabelas de auth/storage/realtime ate
-- o COMMIT (MEDIDO na copia, por diferenca de pg_locks: 16 auth, 5 storage, 2 realtime - login, upload e Realtime esperam) - transacao
-- curtissima; lock_timeout 1500ms (55P03 = nada mudou, rodar de novo). Apaga os 6 gatilhos e a funcao. O DROP TABLE (so com a
-- confirmacao) trava SO a propria tabela (+ indices/toast; medido sozinho: nada em auth/storage/realtime).
-- A TABELA public.estoque_mov_log (o historico das mudancas; NAO se reconstroi) SO cai com a confirmacao explicita na MESMA transacao:
--   SET LOCAL app.confirmo_apagar_estoque_mov_log = 'sim';   (EXTRA_SQL do aplica_v2, logo depois do BEGIN; ou PGOPTIONS)
-- sem ela a tabela FICA (NOTICE com a contagem de linhas). Idempotente. Vem DEPOIS do _down_drop da 177000 (LIFO): o extrato le a tabela.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_estoque_mov_log()')));
  IF v IS NOT NULL AND v <> '910a696b98994505c5257369bb9df434' THEN
    RAISE EXCEPTION 'urg_r3_176000_down_drop: public.fn_estoque_mov_log() nao esta no texto neutro (md5 %) - rode o 20261103176000_down antes', v USING ERRCODE = 'P0001';
  END IF;
  SELECT string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', ') INTO v
    FROM pg_trigger t
   WHERE t.tgfoid = to_regprocedure('public.fn_estoque_mov_log()')
     AND NOT (t.tgrelid IN ('public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass) AND t.tgname IN ('trg_estoque_mov_log_ins', 'trg_estoque_mov_log_upd', 'trg_estoque_mov_log_del'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r3_176000_down_drop: outros gatilhos usam public.fn_estoque_mov_log(): %', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_estoque_mov_log_ins ON public.cad_aviamentos;
DROP TRIGGER IF EXISTS trg_estoque_mov_log_upd ON public.cad_aviamentos;
DROP TRIGGER IF EXISTS trg_estoque_mov_log_del ON public.cad_aviamentos;
DROP TRIGGER IF EXISTS trg_estoque_mov_log_ins ON public.cad_etiquetas;
DROP TRIGGER IF EXISTS trg_estoque_mov_log_upd ON public.cad_etiquetas;
DROP TRIGGER IF EXISTS trg_estoque_mov_log_del ON public.cad_etiquetas;
DROP FUNCTION IF EXISTS public.fn_estoque_mov_log();

DO $tabela$
DECLARE
  n bigint;
BEGIN
  IF to_regclass('public.estoque_mov_log') IS NULL THEN
    RETURN;
  END IF;
  IF coalesce(current_setting('app.confirmo_apagar_estoque_mov_log', true), '') = 'sim' THEN
    DROP TABLE public.estoque_mov_log;
  ELSE
    SELECT count(*) INTO n FROM public.estoque_mov_log;
    RAISE NOTICE 'urg_r3_176000_down_drop: public.estoque_mov_log FICA (% linhas) - para apagar: SET LOCAL app.confirmo_apagar_estoque_mov_log = sim na mesma transacao', n;
  END IF;
END
$tabela$;

DO $pos$
BEGIN
  IF to_regprocedure('public.fn_estoque_mov_log()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid IN ('public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass)
                  AND t.tgname IN ('trg_estoque_mov_log_ins', 'trg_estoque_mov_log_upd', 'trg_estoque_mov_log_del'))
     OR (coalesce(current_setting('app.confirmo_apagar_estoque_mov_log', true), '') = 'sim' AND to_regclass('public.estoque_mov_log') IS NOT NULL) THEN
    RAISE EXCEPTION 'urg_r3_176000_down_drop: pos-condicao falhou (gatilho, funcao ou tabela confirmada ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
