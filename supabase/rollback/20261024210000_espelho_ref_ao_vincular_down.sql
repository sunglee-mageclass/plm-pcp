-- INVERSO (passo 1 de 2) de supabase/migrations/20261024210000_espelho_ref_ao_vincular.sql (achados MEDIOS R14, sku #18).
-- NEUTRALIZA fn_espelho_ref_ao_vincular (CREATE OR REPLACE com RETURN NULL): vincular produto deixa de copiar a REF ao
-- card. Os 2 gatilhos trg_espelho_ref_ao_vincular ficam de pe, inertes. Sem trava de tabela nem de auth/storage (so a
-- trava de objeto da funcao): pode rodar a qualquer hora (e o freio de emergencia). O DROP fica no
-- 20261024210000_espelho_ref_ao_vincular_down_drop.sql (SEPARADO, opcional, horario calmo).
-- Guarda: so roda se a funcao esta com o texto da ida (7e60628faafaf26beb5920abe75da5c7); neutra/ausente/outro -> P0001 e nada muda.
-- Nada gravado muda: REFs ja copiadas ficam (REF revelada nao volta). Sem site a voltar.
-- ORDEM (G-MIGRATION M1): este _down roda ANTES da volta de emergencia da Integracao (volta-producao.sh /
-- 20261007130000_integracao_4_trava_down.sql apaga _integracao_campo_travado). A funcao da ida e defensiva (fix round 1:
-- ausente = nao travado, sem 42883), mas a ordem recomendada continua esta; o roteiro da volta da Integracao confere
-- fn_espelho_ref_ao_vincular ausente ou NEUTRA (42bcb3e5) e PARA senao.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_espelho_ref_ao_vincular()') IS NULL THEN
    RAISE EXCEPTION 'medios_r14_sku18 (volta): fn_espelho_ref_ao_vincular nao existe - a 20261024210000 nao foi aplicada' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_espelho_ref_ao_vincular()'))) IS DISTINCT FROM '7e60628faafaf26beb5920abe75da5c7' THEN
    RAISE EXCEPTION 'medios_r14_sku18 (volta): fn_espelho_ref_ao_vincular nao esta com o texto da 20261024210000 (md5 %) - ja neutralizada ou outra frente mexeu',
      md5(pg_get_functiondef(to_regprocedure('public.fn_espelho_ref_ao_vincular()'))) USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE TEMP TABLE _r14rv_acl_antes ON COMMIT DROP AS
  SELECT (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_espelho_ref_ao_vincular()')) AS acl;

CREATE OR REPLACE FUNCTION public.fn_espelho_ref_ao_vincular()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R14 sku #18] NEUTRALIZADA pelo inverso (supabase/rollback/20261024210000_espelho_ref_ao_vincular_down.sql): o
-- gatilho fica de pe, inerte (vincular nao copia mais a REF). DROP do gatilho/funcao so no _down_drop (horario calmo).
BEGIN
  RETURN NULL;
END
$function$;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_espelho_ref_ao_vincular()'))) IS DISTINCT FROM '42bcb3e5845ac9753e5fb3ffa40813c8' THEN
    RAISE EXCEPTION 'medios_r14_sku18 (volta): pos-condicao falhou - a funcao nao ficou neutra' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_espelho_ref_ao_vincular()')) IS DISTINCT FROM (SELECT acl FROM _r14rv_acl_antes) THEN
    RAISE EXCEPTION 'medios_r14_sku18 (volta): pos-condicao falhou - a ACL da funcao mudou' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname = 'trg_espelho_ref_ao_vincular') <> 2 THEN
    RAISE EXCEPTION 'medios_r14_sku18 (volta): os 2 gatilhos deviam continuar de pe (inertes)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
