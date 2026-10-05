-- DROP opcional de supabase/migrations/20261103172000_urg_r1_custo_fila_grade.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Rodar SO depois do 20261103172000_down (funcao no texto NEUTRO) e com o SITE ja voltado, em HORARIO CALMO: DROP TRIGGER pega
-- AccessExclusiveLock em public.modelo_grades E, pelo supautils, prende 23 tabelas de auth/storage/realtime ate o COMMIT (MEDIDO na
-- copia, por diferenca de pg_locks: 16 auth, 5 storage, 2 realtime - login, upload e Realtime esperam) - transacao curtissima;
-- lock_timeout 1500ms (55P03 = nada mudou, rodar de novo). Apaga os 3 gatilhos e a funcao.
-- Nenhum dado se perde. Vem ANTES do _down_drop da 20261103170000 (LIFO).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_custo_fila_grade()')));
  IF v IS NOT NULL AND v <> '619e266e6dbbc469637802b8acf9920a' THEN
    RAISE EXCEPTION 'urg_r1_172000_down_drop: public.fn_custo_fila_grade() nao esta no texto neutro (md5 %) - rode o 20261103172000_down antes', v USING ERRCODE = 'P0001';
  END IF;
  SELECT string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ', ') INTO v
    FROM pg_trigger t
   WHERE t.tgfoid = to_regprocedure('public.fn_custo_fila_grade()')
     AND NOT (t.tgrelid = 'public.modelo_grades'::regclass AND t.tgname IN ('trg_custo_fila_grade_ins', 'trg_custo_fila_grade_upd', 'trg_custo_fila_grade_del'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r1_172000_down_drop: outros gatilhos usam public.fn_custo_fila_grade(): %', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_custo_fila_grade_ins ON public.modelo_grades;
DROP TRIGGER IF EXISTS trg_custo_fila_grade_upd ON public.modelo_grades;
DROP TRIGGER IF EXISTS trg_custo_fila_grade_del ON public.modelo_grades;
DROP FUNCTION IF EXISTS public.fn_custo_fila_grade();

DO $pos$
BEGIN
  IF to_regprocedure('public.fn_custo_fila_grade()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.modelo_grades'::regclass AND t.tgname IN ('trg_custo_fila_grade_ins', 'trg_custo_fila_grade_upd', 'trg_custo_fila_grade_del')) THEN
    RAISE EXCEPTION 'urg_r1_172000_down_drop: pos-condicao falhou (gatilho ou funcao ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
