-- Volta da 20261127140000 (Kanban PL Onda 2, Task 7: entrada/saida do card no PL pela trilha de peca teste).
-- NEUTRALIZA as 2 funcoes (CREATE OR REPLACE - sem trava de tabela e sem DROP; NAO toca auth/storage):
--   - fn_etapas_pl_entrada          -> so devolve NULL (os gatilhos seguem existindo, inertes);
--   - _etapas_pl_entrada_avaliar    -> no-op (nada grava).
-- Idempotente. A ACL e reafirmada (EXECUTE revogado dos 3). O DROP dos gatilhos e das funcoes fica no ..._down_drop.sql
-- SEPARADO e opcional (DROP TRIGGER em modelo_servico_mo/categorias_terceirizado prende auth/storage ate o COMMIT: horario calmo).
-- Dado NAO volta sozinho: cards que ENTRARAM/SAIRAM do PL por esta regra ficam como estao (status_etapa_pl nao e revertido).
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261127140000_etapas_pl_entrada_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

CREATE OR REPLACE FUNCTION public._etapas_pl_entrada_avaliar(_modelo uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL7_NEUTRO: volta da 20261127140000 - entrada/saida pela peca teste desativada (nada grava).
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_etapas_pl_entrada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- KPL7_NEUTRO: volta da 20261127140000 - os gatilhos seguem, mas nao decidem nada.
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._etapas_pl_entrada_avaliar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_entrada() FROM PUBLIC, anon, authenticated;

-- Pos-condicao: as 2 funcoes estao NEUTRAS e a ACL segue a da ida.
DO $pos$
BEGIN
  IF (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public._etapas_pl_entrada_avaliar(uuid)')) NOT LIKE '%KPL7_NEUTRO%'
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_etapas_pl_entrada()')) NOT LIKE '%KPL7_NEUTRO%' THEN
    RAISE EXCEPTION 'kpl_o2en_down: as funcoes nao ficaram neutras' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public._etapas_pl_entrada_avaliar(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._etapas_pl_entrada_avaliar(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._etapas_pl_entrada_avaliar(uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.fn_etapas_pl_entrada()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_etapas_pl_entrada()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_etapas_pl_entrada()', 'EXECUTE') THEN
    RAISE EXCEPTION 'kpl_o2en_down: ACL inesperada apos a volta' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
