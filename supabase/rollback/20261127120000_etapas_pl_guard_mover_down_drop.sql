-- DROP opcional da 20261127120000 (Kanban PL Onda 2, Task 6). SO DEPOIS do ..._down.sql (as 2 funcoes tem de estar
-- NEUTRAS - o proprio _down as deixa assim; recusa se nao estiverem) e com o SITE ja voltado (nenhuma tela chama
-- etapas_pl_mover ainda na Onda 2, mas a Onda 3 chamara).
-- ⚠️ HORARIO CALMO: o DROP TRIGGER em `public.modelos` dispara o hook supautils e prende AccessExclusive nas ~23
-- tabelas de auth/storage/realtime ATE O COMMIT (ver reference_policy_ddl_trava_auth) - o login pode esperar durante a
-- txn. A txn abaixo e curtissima (so catalogo) e com lock_timeout: 55P03/40P01 = nada mudou, rodar de novo.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261127120000_etapas_pl_guard_mover_down_drop.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_etapas_pl_status_guard()') IS NOT NULL
     AND (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_etapas_pl_status_guard()')) NOT LIKE '%KPL6_NEUTRO%' THEN
    RAISE EXCEPTION 'kpl_o2gm_down_drop: fn_etapas_pl_status_guard nao esta neutra - rode o _down antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.etapas_pl_mover(uuid,text)') IS NOT NULL
     AND (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.etapas_pl_mover(uuid,text)')) NOT LIKE '%KPL6_NEUTRO%' THEN
    RAISE EXCEPTION 'kpl_o2gm_down_drop: etapas_pl_mover nao esta neutra - rode o _down antes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_etapas_pl_status_guard ON public.modelos;
DROP FUNCTION IF EXISTS public.fn_etapas_pl_status_guard();
DROP FUNCTION IF EXISTS public.etapas_pl_mover(uuid, text);

COMMIT;

select pg_notify('pgrst', 'reload schema');
