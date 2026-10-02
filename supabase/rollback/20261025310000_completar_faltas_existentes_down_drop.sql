-- INVERSO (pecas, SEPARADO e opcional) de supabase/migrations/20261025310000_completar_faltas_existentes.sql: DROP das 3
-- funcoes da P-214 B. A tabela _bkp_p214_deficit FICA (historico da correcao). Rodar DEPOIS do _down (dados) se a
-- correcao foi aplicada. So DROP FUNCTION (sem trava de tabela, sem DROP TRIGGER/POLICY).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

DROP FUNCTION IF EXISTS public._p214_completar_faltas(jsonb,text);
DROP FUNCTION IF EXISTS public._p214_previa();
DROP FUNCTION IF EXISTS public._p214_executar();

DO $pos$
BEGIN
  IF to_regprocedure('public._p214_executar()') IS NOT NULL OR to_regprocedure('public._p214_previa()') IS NOT NULL
     OR to_regprocedure('public._p214_completar_faltas(jsonb,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'medios_r15a_p214 (volta drop): funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
