-- Inverso de 20261007110000_integracao_2_retrato.sql — só DROP das 15 funções novas (nenhuma função existente foi
-- redefinida pela 2). Rodar SÓ depois do inverso 3 (guarda LIFO). Não apaga dado.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.integracao_marcar(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_2_down: volte a migration 3 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.integracao_config_ler();
DROP FUNCTION IF EXISTS public.integracao_estado_modelos(uuid[]);
DROP FUNCTION IF EXISTS public.integracao_listar(text, jsonb, integer);
DROP FUNCTION IF EXISTS public.integracao_previa(uuid[]);
DROP FUNCTION IF EXISTS public._integracao_exige_super();
DROP FUNCTION IF EXISTS public._integracao_exige(boolean);
DROP FUNCTION IF EXISTS public._integracao_base(uuid);
DROP FUNCTION IF EXISTS public._integracao_gates(uuid);
DROP FUNCTION IF EXISTS public._integracao_gate(boolean, text, boolean, text);
DROP FUNCTION IF EXISTS public._integracao_assinar(jsonb);
DROP FUNCTION IF EXISTS public._integracao_retrato_core(uuid, text[], jsonb);
DROP FUNCTION IF EXISTS public._integracao_mascarar(jsonb);
DROP FUNCTION IF EXISTS public._integracao_num(numeric, integer);
DROP FUNCTION IF EXISTS public._integracao_cfg(uuid);
DROP FUNCTION IF EXISTS public._integracao_rotulos();

DO $pos$
BEGIN
  IF to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_2_down: funcoes da migration 2 ainda existem' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
