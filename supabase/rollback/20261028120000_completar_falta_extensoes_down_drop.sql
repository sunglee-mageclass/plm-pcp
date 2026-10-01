-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261028120000_completar_falta_extensoes.sql (achados
-- LEVES L6): DROP TRIGGER trg_deficit_corte_item_artigo (ocs_tecido_itens) e trg_deficit_corte_artigo_rend (artigos) +
-- DROP FUNCTION fn_completar_deficit_corte_artigo e reprocessar_faltas_corte.
-- ATENCAO: DROP TRIGGER pega AccessExclusive em ocs_tecido_itens/artigos e prende ~23 tabelas auth/storage/realtime
-- (supautils.policy_grants) ate o COMMIT: HORARIO CALMO, transacao curtissima. Rodar SO depois do _down (exige as 2
-- funcoes NEUTRAS). Volta os gatilhos das 2 tabelas ao conjunto de antes (ocs_tecido_itens 4:01bd4754 = R15a "depois";
-- artigos 5:48889294). Rodar 2x = no-op. LIFO: antes do _down_drop da R15a (20261025300000), que confere ocs_tecido_itens 2:...
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_completar_deficit_corte_artigo()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.fn_completar_deficit_corte_artigo()'))) IS DISTINCT FROM '7e4b933c428ae140c239b7ad6c798019' THEN
    RAISE EXCEPTION 'leves_l6_falta (volta drop): a funcao dos gatilhos nao esta NEUTRA - rodar o _down antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.reprocessar_faltas_corte(uuid)') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.reprocessar_faltas_corte(uuid)'))) IS DISTINCT FROM 'cc00b41f5ad93b4e3ba03a5cdb4e6edf' THEN
    RAISE EXCEPTION 'leves_l6_falta (volta drop): reprocessar_faltas_corte nao esta NEUTRA - rodar o _down antes' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DROP TRIGGER IF EXISTS trg_deficit_corte_item_artigo ON public.ocs_tecido_itens;
DROP TRIGGER IF EXISTS trg_deficit_corte_artigo_rend ON public.artigos;
DROP FUNCTION IF EXISTS public.fn_completar_deficit_corte_artigo();
DROP FUNCTION IF EXISTS public.reprocessar_faltas_corte(uuid);

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('trg_deficit_corte_item_artigo', 'trg_deficit_corte_artigo_rend'))
     OR to_regprocedure('public.fn_completar_deficit_corte_artigo()') IS NOT NULL
     OR to_regprocedure('public.reprocessar_faltas_corte(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'leves_l6_falta (volta drop): gatilho ou funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido_itens', '4:01bd475466e7e45c7b93691afd66ed28'),
      ('artigos',          '5:48889294c9428587a989de88868c2842')) v(tab, antes) LOOP
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.antes THEN
      RAISE EXCEPTION 'leves_l6_falta (volta drop): gatilhos de % = % (esperado o de antes %)', r.tab, v_set, r.antes USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
