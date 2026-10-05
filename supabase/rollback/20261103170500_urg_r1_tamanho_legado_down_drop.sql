-- DROP opcional de supabase/migrations/20261103170500_urg_r1_tamanho_legado.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Rodar SO depois do _down (funcoes no texto NEUTRO). Apaga as 2 funcoes e a tabela de backup public._bkp_urg_r1_tamanho_legado: o historico do
-- antes/depois da correcao SE PERDE - com linhas no backup exige SET LOCAL app.confirmo_apagar_backup_tamanho_legado = 'sim' na
-- mesma txn. Trava: AccessExclusive SO na tabela de backup (ninguem a usa). Vem ANTES do _down_drop da 20261103170000.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
  n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('public._urg_r1_tamanho_legado_lista()', 'ec571c054460a10676852e532c931e03'), ('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)', 'f7d613fb53dbaef6be59c467bbaad580')) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.m THEN
      RAISE EXCEPTION 'urg_r1_170500_down_drop: % nao esta no texto neutro (md5 %) - rode o 20261103170500_down antes', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public._bkp_urg_r1_tamanho_legado') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public._bkp_urg_r1_tamanho_legado' INTO n;
  END IF;
  IF n > 0 AND coalesce(current_setting('app.confirmo_apagar_backup_tamanho_legado', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'urg_r1_170500_down_drop: o backup tem % linha(s) - confirme com SET LOCAL app.confirmo_apagar_backup_tamanho_legado = sim', n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._urg_r1_tamanho_legado_rodar(jsonb,text,integer);
DROP FUNCTION IF EXISTS public._urg_r1_tamanho_legado_lista();
DROP TABLE IF EXISTS public._bkp_urg_r1_tamanho_legado;

DO $pos$
BEGIN
  IF to_regprocedure('public._urg_r1_tamanho_legado_lista()') IS NOT NULL OR to_regprocedure('public._urg_r1_tamanho_legado_rodar(jsonb,text,integer)') IS NOT NULL
     OR to_regclass('public._bkp_urg_r1_tamanho_legado') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r1_170500_down_drop: pos-condicao falhou (funcao ou tabela ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
