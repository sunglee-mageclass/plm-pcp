-- DROP separado de supabase/migrations/20261103130000_mod_reprovado_check.sql (+ 20261103131000). OPCIONAL, depois do _down.
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M11, §6 T4, §13.3). Escrito a mao.
-- Remove os 2 CHECK de modelos e o helper _modelo_eh_reprovado. RECUSA (P0001) se qualquer outra funcao de public citar o
-- helper (quem passou a usa-lo tem de sair antes) ou se o helper/CHECK tiverem outro texto (outra frente mexeu).
-- Trava: DROP CONSTRAINT = AccessExclusive em public.modelos (a tabela mais QUENTE) por um instante, ate o COMMIT; mesmo padrao
-- da ida (LOCK TABLE em ate 1500ms, ate 3 tentativas, solta tudo entre elas). HORARIO CALMO. Nada em auth/storage/realtime.
-- Ja removido = nada a fazer (sem trava). 55P03/40P01 = nada mudou; rodar o arquivo de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO v
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname <> '_modelo_eh_reprovado'
     AND p.prosrc ~ '\y_modelo_eh_reprovado\y';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'mod4_drop: ainda citam _modelo_eh_reprovado (tire-os antes): %', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._modelo_eh_reprovado(text,text)')));
  IF v IS NOT NULL AND v <> 'aa2a5c1672a70f0316660cb3c5f86f23' THEN
    RAISE EXCEPTION 'mod4_drop: _modelo_eh_reprovado com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('modelos_status_dev_normalizado_chk', '((status_desenvolvimento)::text = lower(btrim((status_desenvolvimento)::text)))'),
      ('modelos_status_plan_normalizado_chk', '((status_planejamento)::text = lower(btrim((status_planejamento)::text)))')
    ) AS x(nome, expr) LOOP
    SELECT pg_get_expr(k.conbin, k.conrelid) INTO v
      FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass AND k.conname = r.nome;
    IF FOUND AND v IS DISTINCT FROM r.expr THEN
      RAISE EXCEPTION 'mod4_drop: % com outra definicao (%) - outra frente mexeu', r.nome, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

DO $trava$
DECLARE
  i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
                  AND k.conname IN ('modelos_status_dev_normalizado_chk', 'modelos_status_plan_normalizado_chk')) THEN
    RETURN;  -- ja removidas: sem trava
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.modelos IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.modelos DROP CONSTRAINT IF EXISTS modelos_status_dev_normalizado_chk;
      ALTER TABLE public.modelos DROP CONSTRAINT IF EXISTS modelos_status_plan_normalizado_chk;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$trava$;

DROP FUNCTION IF EXISTS public._modelo_eh_reprovado(text, text);

DO $pos$
BEGIN
  IF to_regprocedure('public._modelo_eh_reprovado(text,text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
                 AND k.conname IN ('modelos_status_dev_normalizado_chk', 'modelos_status_plan_normalizado_chk')) THEN
    RAISE EXCEPTION 'mod4_drop: pos-condicao falhou (helper ou constraint ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
