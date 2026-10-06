-- DROP opcional de supabase/migrations/20261103198000_urg_r1b_enviar_tamanho.sql - GERADO por .superpowers/sdd/2026-10-06-r1b/gerar/gerar.py (nunca editar a mao; rode o gerador de novo).
-- Rodar SO depois do _down (funcoes no texto NEUTRO). Apaga as 2 funcoes e a tabela de backup public._bkp_urg_r1b_enviar: o historico do
-- antes/depois da correcao SE PERDE - com linhas no backup exige a GUC app.confirmo_apagar_backup_enviar_tamanho = 'sim' na SESSAO
-- (o arquivo abre o proprio BEGIN: um SET LOCAL dado antes nao vale): PGOPTIONS='-c app.confirmo_apagar_backup_enviar_tamanho=sim'
-- psql -v ON_ERROR_STOP=1 -f <este arquivo>. Trava: AccessExclusive SO na tabela de backup (ninguem a usa). Vem ANTES dos _down_drop da Onda 1 (170500/170000).
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
  FOR r IN SELECT * FROM (VALUES ('public._urg_r1b_enviar_previa()', 'db45b0b5ef1f5d901d6d916231d7b922'), ('public._urg_r1b_enviar_rodar(jsonb,text,integer)', 'ee1f3f18beed61a257e00937e543ac29')) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.m THEN
      RAISE EXCEPTION 'urg_r1b_198000_down_drop: % nao esta no texto neutro (md5 %) - rode o 20261103198000_down antes', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public._bkp_urg_r1b_enviar') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public._bkp_urg_r1b_enviar' INTO n;
  END IF;
  IF n > 0 AND coalesce(current_setting('app.confirmo_apagar_backup_enviar_tamanho', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'urg_r1b_198000_down_drop: o backup tem % linha(s) - confirme com PGOPTIONS=-c app.confirmo_apagar_backup_enviar_tamanho=sim (GUC de sessao)', n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._urg_r1b_enviar_rodar(jsonb,text,integer);
DROP FUNCTION IF EXISTS public._urg_r1b_enviar_previa();
DROP TABLE IF EXISTS public._bkp_urg_r1b_enviar;

DO $pos$
BEGIN
  IF to_regprocedure('public._urg_r1b_enviar_previa()') IS NOT NULL OR to_regprocedure('public._urg_r1b_enviar_rodar(jsonb,text,integer)') IS NOT NULL OR to_regclass('public._bkp_urg_r1b_enviar') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r1b_198000_down_drop: pos-condicao falhou (funcao ou tabela ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
