-- DROP opcional da 20261128100000 (Kanban PL Onda 3, Task 3): remove o gatilho de ENTRADA em `cad` e sua funcao.
-- SO DEPOIS do ..._down.sql (o _down devolve os corpos de ANTES; este arquivo nao mexe neles).
-- ⚠️ HORARIO CALMO: DROP TRIGGER em `public.cad` dispara o hook supautils e prende AccessExclusive nas ~23 tabelas de
-- auth/storage/realtime ATE O COMMIT (ver reference_policy_ddl_trava_auth) - o login pode esperar durante a txn. A txn
-- abaixo e curtissima (so catalogo) e com lock_timeout: 55P03/40P01 = nada mudou, rodar de novo.
-- Sem este DROP o gatilho e inofensivo (chama o helper de ANTES, idempotente), entao NAO ha urgencia.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down_drop.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DROP TRIGGER IF EXISTS trg_etapas_pl_entrada_cad ON public.cad;
DROP FUNCTION IF EXISTS public.fn_etapas_pl_entrada_cad();

COMMIT;

select pg_notify('pgrst', 'reload schema');
