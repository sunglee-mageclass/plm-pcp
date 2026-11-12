-- DROP opcional da 20261127140000 (Kanban PL Onda 2, Task 7). SO DEPOIS do ..._down.sql (as 2 funcoes tem de estar
-- NEUTRAS - o proprio _down as deixa assim; recusa se nao estiverem).
-- ⚠️ HORARIO CALMO: o DROP TRIGGER em `public.modelo_servico_mo` / `public.categorias_terceirizado` dispara o hook supautils
-- e prende AccessExclusive nas ~23 tabelas de auth/storage/realtime ATE O COMMIT (ver reference_policy_ddl_trava_auth) - o
-- login pode esperar durante a txn. A txn abaixo e curtissima (so catalogo) e com lock_timeout: 55P03/40P01 = nada mudou,
-- rodar de novo.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261127140000_etapas_pl_entrada_down_drop.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_etapas_pl_entrada()') IS NOT NULL
     AND (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_etapas_pl_entrada()')) NOT LIKE '%KPL7_NEUTRO%' THEN
    RAISE EXCEPTION 'kpl_o2en_down_drop: fn_etapas_pl_entrada nao esta neutra - rode o _down antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._etapas_pl_entrada_avaliar(uuid)') IS NOT NULL
     AND (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public._etapas_pl_entrada_avaliar(uuid)')) NOT LIKE '%KPL7_NEUTRO%' THEN
    RAISE EXCEPTION 'kpl_o2en_down_drop: _etapas_pl_entrada_avaliar nao esta neutra - rode o _down antes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_etapas_pl_entrada_mo ON public.modelo_servico_mo;
DROP TRIGGER IF EXISTS trg_etapas_pl_entrada_cat ON public.categorias_terceirizado;
DROP FUNCTION IF EXISTS public.fn_etapas_pl_entrada();
DROP FUNCTION IF EXISTS public._etapas_pl_entrada_avaliar(uuid);

COMMIT;

select pg_notify('pgrst', 'reload schema');
