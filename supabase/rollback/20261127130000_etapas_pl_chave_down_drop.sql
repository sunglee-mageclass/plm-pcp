-- DROP opcional da 20261127130000 (Kanban PL Onda 2, Task 8). SO DEPOIS do ..._down.sql (as 5 funcoes tem de estar NEUTRAS - o
-- proprio _down as deixa assim; recusa se nao estiverem) e com o SITE ja voltado (nenhuma tela chama as RPCs na Onda 2, mas a
-- Onda 3 chamara).
-- ⚠️ HORARIO CALMO: o DROP TRIGGER em `public.tenant_config` dispara o hook supautils e prende AccessExclusive nas ~23 tabelas de
-- auth/storage/realtime ATE O COMMIT (ver reference_policy_ddl_trava_auth) - o login pode esperar durante a txn. A txn abaixo e
-- curtissima (so catalogo) e com lock_timeout: 55P03/40P01 = nada mudou, rodar de novo. Perde-se o historico de snapshots
-- (etapas_pl_snapshot) - so existe se alguma loja ligou a chave.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261127130000_etapas_pl_chave_down_drop.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_etapas_pl_chave_protegida()', 'public.fn_etapas_pl_config()',
                           'public.etapas_pl_definir_automatico(boolean)', 'public.etapas_pl_previa_restauracao(uuid)',
                           'public.etapas_pl_restaurar(uuid)'] LOOP
    IF to_regprocedure(f) IS NOT NULL
       AND (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(f)) NOT LIKE '%KPL8_NEUTRO%' THEN
      RAISE EXCEPTION 'kpl_o2ch_down_drop: % nao esta neutra - rode o _down antes', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_etapas_pl_chave_protegida ON public.tenant_config;
DROP TRIGGER IF EXISTS trg_etapas_pl_config ON public.tenant_config;
DROP FUNCTION IF EXISTS public.fn_etapas_pl_chave_protegida();
DROP FUNCTION IF EXISTS public.fn_etapas_pl_config();
DROP FUNCTION IF EXISTS public.etapas_pl_definir_automatico(boolean);
DROP FUNCTION IF EXISTS public.etapas_pl_previa_restauracao(uuid);
DROP FUNCTION IF EXISTS public.etapas_pl_restaurar(uuid);
DROP TABLE IF EXISTS public.etapas_pl_snapshot;

COMMIT;

select pg_notify('pgrst', 'reload schema');
