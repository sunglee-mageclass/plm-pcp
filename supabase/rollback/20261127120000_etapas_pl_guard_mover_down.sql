-- Volta da 20261127120000 (Kanban PL Onda 2, Task 6: fn_etapas_pl_status_guard + trg_etapas_pl_status_guard +
-- etapas_pl_mover). NEUTRALIZA as 2 funcoes (CREATE OR REPLACE - sem trava de tabela e sem DROP; NAO toca auth/storage):
--   - fn_etapas_pl_status_guard -> so devolve NEW (o gatilho segue existindo, inerte: modo manual para todo mundo);
--   - etapas_pl_mover           -> RAISE P0001 ASCII (nada grava; nenhuma tela chama ainda).
-- Idempotente. A ACL e mantida/reafirmada (guard sem EXECUTE; mover so authenticated). O DROP do gatilho e das funcoes
-- fica no ..._down_drop.sql SEPARADO e opcional (DROP TRIGGER em `modelos` prende auth/storage ate o COMMIT: horario calmo).
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261127120000_etapas_pl_guard_mover_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_etapas_pl_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL6_NEUTRO: volta da 20261127120000 - o gatilho segue, mas nao decide nada.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.etapas_pl_mover(_modelo_id uuid, _para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL6_NEUTRO: volta da 20261127120000 - mover desativado (nada grava).
  RAISE EXCEPTION 'etapas_pl_mover: desativado' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_status_guard() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_mover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_mover(uuid, text) TO authenticated;

-- Pos-condicao: as 2 funcoes estao NEUTRAS e a ACL segue a da ida.
DO $pos$
BEGIN
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_etapas_pl_status_guard()')) NOT LIKE '%KPL6_NEUTRO%'
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.etapas_pl_mover(uuid,text)')) NOT LIKE '%KPL6_NEUTRO%' THEN
    RAISE EXCEPTION 'kpl_o2gm_down: as funcoes nao ficaram neutras' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public.fn_etapas_pl_status_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_etapas_pl_status_guard()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_etapas_pl_status_guard()', 'EXECUTE')
     OR has_function_privilege('public', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.etapas_pl_mover(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'kpl_o2gm_down: ACL inesperada apos a volta' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
