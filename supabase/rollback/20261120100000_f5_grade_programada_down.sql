-- CREATE OR REPLACE neutro + DROP TRIGGER. DROP COLUMN com guarda (a Programada gravada seria perdida: avisar).
BEGIN;
DROP TRIGGER IF EXISTS trg_modelo_grade_programada ON public.modelos;
DROP FUNCTION IF EXISTS public.fn_modelo_grade_programada();
-- A coluna FICA por padrão (aditiva). Para removê-la de vez (apaga a meta gravada), rode com a GUC:
--   SET app.confirmo_apagar_grade_programada='sim'; ALTER TABLE public.modelo_grades DROP COLUMN grades_programada;
COMMIT;
