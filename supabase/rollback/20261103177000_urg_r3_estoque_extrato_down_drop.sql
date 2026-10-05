-- DROP opcional de supabase/migrations/20261103177000_urg_r3_estoque_extrato.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- Rodar SO com o SITE ja voltado (o site novo chama os 3 wrappers no botao Historico). Apaga as 6 funcoes (3 wrappers e depois os
-- 3 _core). Recusa se alguma estiver com OUTRO texto ou se outra funcao de public as citar. Trava: so catalogo (MEDIDO). Idempotente.
-- Vem ANTES do _down_drop da 20261103176000 (LIFO: o extrato le estoque_mov_log).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_tecido_core(uuid,uuid)')));
  IF v IS NOT NULL AND v <> 'bccc3cb6423a88d4942921f2e72c03fb' THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: public._estoque_extrato_tecido_core(uuid,uuid) com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_aviamento_core(uuid,uuid)')));
  IF v IS NOT NULL AND v <> 'c86981af6abf8129f5142e3636083483' THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: public._estoque_extrato_aviamento_core(uuid,uuid) com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._estoque_extrato_insumo_core(uuid,uuid)')));
  IF v IS NOT NULL AND v <> '9f2013ad56ec77e0601d51b32b793708' THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: public._estoque_extrato_insumo_core(uuid,uuid) com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_tecido(uuid)')));
  IF v IS NOT NULL AND v <> '2ce5cc0e1161a0a83479047063464007' THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: public.estoque_extrato_tecido(uuid) com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_aviamento(uuid)')));
  IF v IS NOT NULL AND v <> 'e457e2fb99a6b9554bc03c07eee1838b' THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: public.estoque_extrato_aviamento(uuid) com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.estoque_extrato_insumo(uuid)')));
  IF v IS NOT NULL AND v <> '26909762250ea9bfec6a4c21e5e3eb51' THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: public.estoque_extrato_insumo(uuid) com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname NOT IN ('_estoque_extrato_tecido_core', '_estoque_extrato_aviamento_core', '_estoque_extrato_insumo_core', 'estoque_extrato_tecido', 'estoque_extrato_aviamento', 'estoque_extrato_insumo')
     AND p.prosrc ~ '(estoque_extrato_tecido|estoque_extrato_aviamento|estoque_extrato_insumo)';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: outras funcoes usam o extrato: %', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.estoque_extrato_tecido(uuid);
DROP FUNCTION IF EXISTS public.estoque_extrato_aviamento(uuid);
DROP FUNCTION IF EXISTS public.estoque_extrato_insumo(uuid);
DROP FUNCTION IF EXISTS public._estoque_extrato_tecido_core(uuid,uuid);
DROP FUNCTION IF EXISTS public._estoque_extrato_aviamento_core(uuid,uuid);
DROP FUNCTION IF EXISTS public._estoque_extrato_insumo_core(uuid,uuid);

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public._estoque_extrato_tecido_core(uuid,uuid)', 'public._estoque_extrato_aviamento_core(uuid,uuid)', 'public._estoque_extrato_insumo_core(uuid,uuid)', 'public.estoque_extrato_tecido(uuid)', 'public.estoque_extrato_aviamento(uuid)', 'public.estoque_extrato_insumo(uuid)']) s WHERE to_regprocedure(s) IS NOT NULL) THEN
    RAISE EXCEPTION 'urg_r3_177000_down_drop: pos-condicao falhou (alguma funcao do extrato ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
