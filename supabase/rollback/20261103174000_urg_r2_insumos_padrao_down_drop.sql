-- DROP opcional da coluna de supabase/migrations/20261103174000_urg_r2_insumos_padrao.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a2.mjs (nunca editar a mao).
-- Rodar SO com o SITE ja voltado e DEPOIS do supabase/rollback/20261103174000_urg_r2_insumos_padrao_down.sql (e do _down/_down_drop da 20261103175000, se existir), em HORARIO
-- CALMO: DROP COLUMN pede AccessExclusiveLock em public.tenant_config ate o COMMIT (como na ida: leitura de
-- tenant_config, portoes de modulo e policies de escrita esperam) - mesmo laco da ida: tentativa atomica com lock_timeout 1500ms, ate 3x com 1s de pausa; 55P03 = nada mudou, rodar de novo.
-- As listas gravadas SE PERDEM: com alguma loja com lista nao vazia exige SET LOCAL app.confirmo_apagar_insumos_padrao = 'sim' na
-- mesma txn. Guarda: nenhuma funcao de public cita a coluna (varre o prosrc, inclusive comentarios - recusa enquanto
-- salvar_config_loja estiver com o texto da ida ou alguem ler a lista).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosrc ~ 'insumos_padrao';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r2_174000_down_drop: funcoes ainda citam tenant_config.insumos_padrao: % - rode os _down antes', v
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $drop$
DECLARE
  i int;
  n bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'insumos_padrao' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.tenant_config IN ACCESS EXCLUSIVE MODE;
      EXECUTE 'SELECT count(*) FROM public.tenant_config WHERE insumos_padrao IS DISTINCT FROM ''[]''::jsonb' INTO n;
      IF n > 0 AND coalesce(current_setting('app.confirmo_apagar_insumos_padrao', true), '') <> 'sim' THEN
        RAISE EXCEPTION 'urg_r2_174000_down_drop: % loja(s) com lista de insumos padrao gravada - confirme com SET LOCAL app.confirmo_apagar_insumos_padrao = sim', n
          USING ERRCODE = 'P0001';
      END IF;
      ALTER TABLE public.tenant_config DROP COLUMN insumos_padrao;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$drop$;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'insumos_padrao' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'urg_r2_174000_down_drop: pos-condicao falhou (a coluna ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
