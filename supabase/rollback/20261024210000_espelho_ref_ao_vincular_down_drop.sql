-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261024210000_espelho_ref_ao_vincular.sql (achados
-- MEDIOS R14, sku #18): DROP TRIGGER trg_espelho_ref_ao_vincular (produtos_acabados e produtos_importados) + DROP FUNCTION
-- fn_espelho_ref_ao_vincular.
-- ATENCAO: DROP TRIGGER pega AccessExclusive nas 2 tabelas de produto e prende ~23 tabelas auth/storage/realtime
-- (supautils.policy_grants) ate o COMMIT: HORARIO CALMO, transacao curtissima. Rodar SO depois do _down (exige a funcao
-- NEUTRA, md5 42bcb3e5845ac9753e5fb3ffa40813c8). Volta os gatilhos das 2 tabelas ao conjunto do Passo 0 (10 + 10).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_espelho_ref_ao_vincular()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.fn_espelho_ref_ao_vincular()'))) IS DISTINCT FROM '42bcb3e5845ac9753e5fb3ffa40813c8' THEN
    RAISE EXCEPTION 'medios_r14_sku18 (volta drop): a funcao do gatilho nao esta NEUTRA - rodar o _down antes' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DROP TRIGGER IF EXISTS trg_espelho_ref_ao_vincular ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_espelho_ref_ao_vincular ON public.produtos_importados;
DROP FUNCTION IF EXISTS public.fn_espelho_ref_ao_vincular();

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_espelho_ref_ao_vincular') OR to_regprocedure('public.fn_espelho_ref_ao_vincular()') IS NOT NULL THEN
    RAISE EXCEPTION 'medios_r14_sku18 (volta drop): gatilho ou funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('produtos_acabados', '10:cdab1723eecc2cfe70b8589e961630f7'),
      ('produtos_importados', '10:6240c87feae9183998f368009fcb2abb')) v(tab, antes) LOOP
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.antes THEN
      RAISE EXCEPTION 'medios_r14_sku18 (volta drop): gatilhos de % = % (esperado o do Passo 0 %)', r.tab, v_set, r.antes USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
