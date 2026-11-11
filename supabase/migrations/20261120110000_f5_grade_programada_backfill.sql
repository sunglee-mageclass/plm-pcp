-- F5-2 Task 6: backfill retroativo da grade Programada (correcao unica).
-- So CRIA a funcao; NAO roda sozinha. Roda manualmente com a GUC de confirmacao:
--   BEGIN; SET LOCAL app.confirmo_grade_programada_backfill='sim'; SELECT public._grade_programada_backfill_rodar(); COMMIT;
-- Idempotente: so preenche linhas NULL de cards com Ordem de Criacao enviada. Nao sobrescreve Programada ja gravada.
-- Exige a coluna modelo_grades.grades_programada (migration 20261120100000).
BEGIN;
CREATE OR REPLACE FUNCTION public._grade_programada_backfill_rodar()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE n integer;
BEGIN
  IF current_setting('app.confirmo_grade_programada_backfill', true) IS DISTINCT FROM 'sim' THEN
    RAISE EXCEPTION 'confirme: SET app.confirmo_grade_programada_backfill=''sim'''; END IF;
  UPDATE public.modelo_grades mg SET grades_programada = mg.grades
    FROM public.modelos m
   WHERE mg.modelo_id = m.id AND m.ordem_criacao_enviada IS TRUE AND mg.grades_programada IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._grade_programada_backfill_rodar() FROM PUBLIC, anon, authenticated;
COMMIT;
