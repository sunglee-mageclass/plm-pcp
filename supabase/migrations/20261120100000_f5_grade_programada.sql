BEGIN;
-- Coluna da Programada (meta oficial). NULL = ainda não congelada.
ALTER TABLE public.modelo_grades ADD COLUMN IF NOT EXISTS grades_programada jsonb;

-- Congela ao enviar a Ordem de Criação: copia grades -> grades_programada nas linhas que ainda estão NULL.
-- AFTER (fn_modelo_ref_auto é BEFORE, sem conflito) + escreve em modelo_grades (tabela-filha, sem recursão).
CREATE OR REPLACE FUNCTION public.fn_modelo_grade_programada()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF NEW.ordem_criacao_enviada IS TRUE
     AND OLD.ordem_criacao_enviada IS DISTINCT FROM NEW.ordem_criacao_enviada THEN
    UPDATE public.modelo_grades
       SET grades_programada = grades
     WHERE modelo_id = NEW.id
       AND grades_programada IS NULL;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_grade_programada() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_modelo_grade_programada ON public.modelos;
CREATE TRIGGER trg_modelo_grade_programada
  AFTER UPDATE OF ordem_criacao_enviada ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_grade_programada();
COMMIT;
