-- Derruba so a funcao do backfill. A coluna e os dados ja backfillados FICAM (correcao unica; nao ha como distinguir
-- o que foi preenchido pelo backfill do que foi congelado pelo gatilho).
BEGIN;
DROP FUNCTION IF EXISTS public._grade_programada_backfill_rodar();
COMMIT;
