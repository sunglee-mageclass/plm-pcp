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
DECLARE
  n integer;
BEGIN
  -- Minor #7: confere as 15, não só 1 (a suite ja testava as 15; o arquivo que roda em producao tinha so 1) -
  -- e este e o texto que de fato roda em producao.
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('_integracao_rotulos', '_integracao_cfg', '_integracao_num', '_integracao_mascarar',
       '_integracao_retrato_core', '_integracao_assinar', '_integracao_gate', '_integracao_gates', '_integracao_base',
       '_integracao_exige', '_integracao_exige_super', 'integracao_previa', 'integracao_listar',
       'integracao_estado_modelos', 'integracao_config_ler');
  IF n <> 0 THEN
    RAISE EXCEPTION 'integracao_2_down: % funcao(oes) da migration 2 ainda existem', n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
