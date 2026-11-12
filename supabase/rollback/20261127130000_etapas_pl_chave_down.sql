-- Volta da 20261127130000 (Kanban PL Onda 2, Task 8: chave protegida etapas_pl_automatico + etapas_pl_definir_automatico +
-- etapas_pl_snapshot + snapshot/restaurar). NEUTRALIZA as 5 funcoes (CREATE OR REPLACE - sem trava de tabela e sem DROP; NAO toca
-- auth/storage):
--   - fn_etapas_pl_chave_protegida -> so devolve NEW (o gatilho segue, inerte: a chave volta a poder ser gravada direto);
--   - fn_etapas_pl_config          -> so devolve NULL (nao snapshota nem move cards);
--   - etapas_pl_definir_automatico / etapas_pl_previa_restauracao / etapas_pl_restaurar -> RAISE P0001 ASCII (nada grava).
-- A tabela etapas_pl_snapshot FICA (so o ..._down_drop.sql a apaga). Idempotente. A ACL e mantida/reafirmada.
-- ⚠️ Antes de voltar, se alguma loja ligou a chave: ela continua ligada (o valor da coluna nao e tocado aqui).
-- O DROP dos gatilhos/funcoes/tabela fica no ..._down_drop.sql SEPARADO e opcional (DROP TRIGGER em `tenant_config` prende
-- auth/storage ate o COMMIT: horario calmo).
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261127130000_etapas_pl_chave_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

CREATE OR REPLACE FUNCTION public.fn_etapas_pl_chave_protegida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL8_NEUTRO: volta da 20261127130000 - o gatilho segue, mas nao protege a chave.
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_etapas_pl_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL8_NEUTRO: volta da 20261127130000 - sem snapshot e sem mover cards.
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.etapas_pl_definir_automatico(_ligar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL8_NEUTRO: volta da 20261127130000 - desativado (nada grava).
  RAISE EXCEPTION 'etapas_pl_definir_automatico: desativado' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.etapas_pl_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL8_NEUTRO: volta da 20261127130000 - desativado.
  RAISE EXCEPTION 'etapas_pl_previa_restauracao: desativado' USING ERRCODE = 'P0001';
END;
$function$;

CREATE OR REPLACE FUNCTION public.etapas_pl_restaurar(_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL8_NEUTRO: volta da 20261127130000 - desativado (nada grava).
  RAISE EXCEPTION 'etapas_pl_restaurar: desativado' USING ERRCODE = 'P0001';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_chave_protegida() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_config() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_definir_automatico(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_definir_automatico(boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_previa_restauracao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_previa_restauracao(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.etapas_pl_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.etapas_pl_restaurar(uuid) TO authenticated;

-- Pos-condicao: as 5 funcoes estao NEUTRAS e a ACL segue a da ida.
DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.fn_etapas_pl_chave_protegida()', 'public.fn_etapas_pl_config()',
                           'public.etapas_pl_definir_automatico(boolean)', 'public.etapas_pl_previa_restauracao(uuid)',
                           'public.etapas_pl_restaurar(uuid)'] LOOP
    IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure(f)) NOT LIKE '%KPL8_NEUTRO%' THEN
      RAISE EXCEPTION 'kpl_o2ch_down: % nao ficou neutra', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'public.fn_etapas_pl_chave_protegida()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_etapas_pl_chave_protegida()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_etapas_pl_chave_protegida()', 'EXECUTE')
     OR has_function_privilege('public', 'public.fn_etapas_pl_config()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_etapas_pl_config()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_etapas_pl_config()', 'EXECUTE')
     OR has_function_privilege('public', 'public.etapas_pl_definir_automatico(boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.etapas_pl_definir_automatico(boolean)', 'EXECUTE')
     OR has_function_privilege('public', 'public.etapas_pl_previa_restauracao(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.etapas_pl_previa_restauracao(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.etapas_pl_restaurar(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.etapas_pl_restaurar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'kpl_o2ch_down: ACL inesperada apos a volta' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
