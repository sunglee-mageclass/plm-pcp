-- DROP opcional da coluna tenant_config.explosao_requisitos (DEPOIS do _down, SITE ja voltado, horario calmo).
-- ⚠️ AccessExclusive em tenant_config ate o COMMIT: TODA checagem de RLS/tenant_module_enabled le esta tabela (fila no app inteiro) -
--    lock_timeout curto + horario calmo (incidente 23/set: DDL em tenant_config trava auth/storage ate o COMMIT).
-- Exige o _down (salvar_config_loja ja sem 'explosao_requisitos'; senao o UPDATE/validacao referenciariam coluna inexistente).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF position('explosao_requisitos' IN pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) > 0 THEN
    RAISE EXCEPTION 'f6_explosao_down_drop: rode o _down antes (salvar_config_loja ainda referencia explosao_requisitos)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $drop$
DECLARE
  i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'explosao_requisitos' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.tenant_config IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS explosao_requisitos;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$drop$;

NOTIFY pgrst, 'reload schema';
COMMIT;
