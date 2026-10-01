-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261025300000_completar_deficit_corte.sql (achados
-- MEDIOS R15a, P-203 A): DROP TRIGGER trg_deficit_corte_item (ocs_tecido_itens) e trg_deficit_corte_oc (ocs_tecido) +
-- DROP FUNCTION fn_completar_deficit_corte e _completar_deficit_corte_variante.
-- ATENCAO: DROP TRIGGER pega AccessExclusive nas 2 tabelas de OC de tecido e prende ~23 tabelas auth/storage/realtime
-- (supautils.policy_grants) ate o COMMIT: HORARIO CALMO, transacao curtissima. Rodar SO depois do _down (exige a funcao do
-- gatilho NEUTRA, md5 0cd9774ed5290d3d9cf57000d33d935a). Volta os gatilhos das 2 tabelas ao conjunto de antes (9 + 2).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_completar_deficit_corte()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.fn_completar_deficit_corte()'))) IS DISTINCT FROM '0cd9774ed5290d3d9cf57000d33d935a' THEN
    RAISE EXCEPTION 'medios_r15a_p203 (volta drop): a funcao do gatilho nao esta NEUTRA - rodar o _down antes' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DROP TRIGGER IF EXISTS trg_deficit_corte_item ON public.ocs_tecido_itens;
DROP TRIGGER IF EXISTS trg_deficit_corte_oc ON public.ocs_tecido;
DROP FUNCTION IF EXISTS public.fn_completar_deficit_corte();
DROP FUNCTION IF EXISTS public._completar_deficit_corte_variante(uuid,uuid);

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_deficit_corte_item', 'trg_deficit_corte_oc'))
     OR to_regprocedure('public.fn_completar_deficit_corte()') IS NOT NULL
     OR to_regprocedure('public._completar_deficit_corte_variante(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'medios_r15a_p203 (volta drop): gatilho ou funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido',       '9:3ce1ed0e9503b257c252701e4a1f07fd'),
      ('ocs_tecido_itens', '2:17a42c7cfd8b461d12cf2605d63d7e04')) v(tab, antes) LOOP
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.antes THEN
      RAISE EXCEPTION 'medios_r15a_p203 (volta drop): gatilhos de % = % (esperado o de antes %)', r.tab, v_set, r.antes USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
