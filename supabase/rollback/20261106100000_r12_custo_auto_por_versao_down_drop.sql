-- DROP de verdade da R12 - GERADO por .superpowers/sdd/2026-11-03-r12/mig/gerar.py (nunca editar a mao). OPCIONAL, DEPOIS do
-- 20261106100000_r12_custo_auto_por_versao_down.sql (sem o _down as funcoes redefinidas ainda citam os helpers e a guarda abaixo recusa), SITE ja voltado, horario calmo.
-- Apaga: os helpers _mo_custo_auto_liberado(uuid,int,numeric), _mo_custo_auto_liberado(uuid), _mo_liberada(uuid,int,numeric) e a
-- coluna tenant_config.aprovar_custo_auto_por_versao. RECUSA (P0001, nada muda) se: alguma OUTRA funcao de public ainda cita os helpers/a coluna, ou alguma loja tem o toggle LIGADO (dado que se perderia) sem
-- SET LOCAL app.confirmo_apagar_toggle_custo_auto = 'sim'.
-- Trava: DROP COLUMN pede AccessExclusive em public.tenant_config (por ms; tentativa atomica 3x com lock_timeout 1500ms - 55P03 =
-- nada mudou, rodar de novo). Os DROP FUNCTION so mexem em catalogo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_outras text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_outras
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.oid NOT IN (coalesce(to_regprocedure('public._mo_custo_auto_liberado(uuid,integer,numeric)'), 0::oid::regprocedure)::oid,
                       coalesce(to_regprocedure('public._mo_custo_auto_liberado(uuid)'), 0::oid::regprocedure)::oid,
                       coalesce(to_regprocedure('public._mo_liberada(uuid,integer,numeric)'), 0::oid::regprocedure)::oid)
     AND (p.prosrc LIKE '%_mo_custo_auto_liberado%' OR p.prosrc LIKE '%aprovar_custo_auto_por_versao%'
          OR p.prosrc ~ '_mo_liberada\([^)]*,[^)]*,');
  IF v_outras IS NOT NULL THEN
    RAISE EXCEPTION 'r12_down_drop: ainda citam os helpers/a coluna: %', v_outras USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'aprovar_custo_auto_por_versao' AND NOT attisdropped) THEN
    IF EXISTS (SELECT 1 FROM public.tenant_config WHERE aprovar_custo_auto_por_versao)
       AND coalesce(current_setting('app.confirmo_apagar_toggle_custo_auto', true), '') <> 'sim' THEN
      RAISE EXCEPTION 'r12_down_drop: ha loja com o toggle LIGADO; confirme com SET LOCAL app.confirmo_apagar_toggle_custo_auto = ''sim'''
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._mo_liberada(uuid, integer, numeric);
DROP FUNCTION IF EXISTS public._mo_custo_auto_liberado(uuid);
DROP FUNCTION IF EXISTS public._mo_custo_auto_liberado(uuid, integer, numeric);

DO $col$
DECLARE
  i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'aprovar_custo_auto_por_versao' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.tenant_config IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.tenant_config DROP COLUMN aprovar_custo_auto_por_versao;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$col$;

COMMIT;
