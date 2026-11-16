-- Volta da migration 20261201100000 (helper de pulo). So derruba a funcao NOVA (nenhum dado, nenhuma tabela, nenhum gatilho; sem trava
-- alem do catalogo). RECUSA enquanto 20261201110000/20261201120000 estiverem no banco (elas CHAMAM o helper): desfaca-as antes (LIFO).
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261201100000_regerar_pulo_integracao_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
DECLARE
  v_md5 text;
  v_uso text;
BEGIN
  IF to_regprocedure('public._regerar_pulo_integracao(uuid)') IS NULL THEN
    RETURN;  -- ja desfeito: no-op
  END IF;
  v_md5 := md5(pg_get_functiondef('public._regerar_pulo_integracao(uuid)'::regprocedure));
  IF v_md5 <> '9449a83d205a6117d2dedc2c637ac0b0' THEN
    RAISE EXCEPTION 'regerar_pulo_down: _regerar_pulo_integracao com texto diferente do da ida (md5 %) - nao derrubo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_uso
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname <> '_regerar_pulo_integracao'
     AND p.prosrc LIKE '%_regerar_pulo_integracao%';
  IF v_uso IS NOT NULL THEN
    RAISE EXCEPTION 'regerar_pulo_down: ainda usado por % - desfaca 20261201120000 e 20261201110000 antes', v_uso USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._regerar_pulo_integracao(uuid);

COMMIT;

select pg_notify('pgrst', 'reload schema');
