-- INVERSO de supabase/migrations/20261028100000_terceirizados_ativo_not_null.sql (achados LEVES L6, prod #11).
-- producao_terceirizados.ativo volta a aceitar NULL (DROP NOT NULL). Nenhum valor gravado muda.
-- Guarda: so roda se a coluna esta NOT NULL (o estado da ida); ja nullable -> P0001 (rodar 2x = a 2a recusa).
-- Trava: AccessExclusiveLock em producao_terceirizados so pelo instante do catalogo (DROP NOT NULL nao varre a tabela);
-- lock_timeout 500 ms -> se falhar, e so rodar de novo. Sem DROP de objeto.
-- LIFO: roda DEPOIS dos inversos 20261028120000 e 20261028110000, ANTES dos inversos da R15a e da R13.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
DECLARE
  v_notnull boolean;
BEGIN
  IF to_regclass('public.producao_terceirizados') IS NULL THEN
    RAISE EXCEPTION 'leves_l6_ativo (volta): tabela producao_terceirizados ausente' USING ERRCODE = 'P0001';
  END IF;
  SELECT a.attnotnull INTO v_notnull
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.producao_terceirizados') AND a.attname = 'ativo' AND NOT a.attisdropped;
  IF v_notnull IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'leves_l6_ativo (volta): producao_terceirizados.ativo nao esta NOT NULL - nada a desfazer'
      USING ERRCODE = 'P0001';
  END IF;
  EXECUTE 'ALTER TABLE public.producao_terceirizados ALTER COLUMN ativo DROP NOT NULL';
END $volta$;

DO $pos$
BEGIN
  IF (SELECT a.attnotnull FROM pg_attribute a
       WHERE a.attrelid = to_regclass('public.producao_terceirizados') AND a.attname = 'ativo' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'leves_l6_ativo (volta): pos-condicao falhou - ativo continua NOT NULL' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
