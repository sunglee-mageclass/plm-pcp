-- DROP opcional da coluna tenant_config.plan_tecido_oc_bloqueia_lancado - DEPOIS do _down (nenhuma funcao pode citar a coluna). Horario calmo
-- (DROP COLUMN pede AccessExclusive em tenant_config por ms; 3 tentativas com lock_timeout 1500ms).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
DO $guarda$
DECLARE v_outras text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_outras FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc LIKE '%plan_tecido_oc_bloqueia_lancado%';
  IF v_outras IS NOT NULL THEN
    RAISE EXCEPTION 'plan_tecido_oc_bloqueia_down_drop: ainda citam a coluna: % (rode o _down antes)', v_outras USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;
DO $col$
DECLARE i int;
BEGIN
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.tenant_config IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS plan_tecido_oc_bloqueia_lancado;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$col$;
NOTIFY pgrst, 'reload schema';
COMMIT;
