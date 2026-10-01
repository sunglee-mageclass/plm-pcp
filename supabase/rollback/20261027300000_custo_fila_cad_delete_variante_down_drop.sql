-- INVERSO (passo 2 de 2, SEPARADO e OPCIONAL) de supabase/migrations/20261027300000_custo_fila_cad_delete_variante.sql
-- (achados LEVES L5, C1 L4): DROP TRIGGER trg_custo_fila_del (cad) e trg_custo_fila_upd (variantes_tecido) + DROP FUNCTION
-- fn_custo_fila_cad_del e fn_custo_fila_variante_tecido.
-- ATENCAO: DROP TRIGGER pega AccessExclusive em cad (tabela QUENTE) e em variantes_tecido e prende as tabelas
-- auth/storage/realtime ate o COMMIT (medido na copia 54422 em pg_locks: 25 tabelas auth.*/storage.*/realtime.*; em
-- producao ~23-24, supautils.policy_grants): HORARIO CALMO, transacao curtissima, lock_timeout 500ms
-- (falhou = nada mudou, rodar de novo). Rodar SO depois do _down (exige as 2 funcoes NEUTRAS, md5 9df86c53 / e92a8444, ou
-- ja ausentes). Volta os gatilhos das 2 tabelas ao conjunto de antes da L5 (cad 9 / variantes_tecido 4).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_custo_fila_cad_del()', '9df86c53e45c99810ec4ba5ca120bedb'),
      ('public.fn_custo_fila_variante_tecido()', 'e92a84443182afee5ce356d70f24384d')) v(s, neutro) LOOP
    IF to_regprocedure(r.s) IS NOT NULL
       AND md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.neutro THEN
      RAISE EXCEPTION 'leves_l5 (volta drop): % nao esta NEUTRA - rodar o _down antes', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

DROP TRIGGER IF EXISTS trg_custo_fila_del ON public.cad;
DROP TRIGGER IF EXISTS trg_custo_fila_upd ON public.variantes_tecido;
DROP FUNCTION IF EXISTS public.fn_custo_fila_cad_del();
DROP FUNCTION IF EXISTS public.fn_custo_fila_variante_tecido();

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_del' AND tgrelid = to_regclass('public.cad'))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_upd' AND tgrelid = to_regclass('public.variantes_tecido'))
     OR to_regprocedure('public.fn_custo_fila_cad_del()') IS NOT NULL
     OR to_regprocedure('public.fn_custo_fila_variante_tecido()') IS NOT NULL THEN
    RAISE EXCEPTION 'leves_l5 (volta drop): gatilho ou funcao ainda existe' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('cad', '9:36b488d7e6efd874c706b6d01f80109c'),
      ('variantes_tecido', '4:5e380b55c9d0d129985b3c45b51add9f')) v(tab, antes) LOOP
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.antes THEN
      RAISE EXCEPTION 'leves_l5 (volta drop): gatilhos de % = % (esperado o de antes da L5 %)', r.tab, v_set, r.antes USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
