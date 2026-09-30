-- INVERSO de supabase/migrations/20261019310000_custo_previsto_backfill.sql (contas certas C2; plano
-- .superpowers/sdd/2026-09-30-contas-certas-cd/plan-cd.md §4 C2 e §6 "Volta", passo 3).
-- Derruba as 4 funcoes da correcao unica (_custo_backfill_rodar, _custo_previa_lista, _custo_lista_hash,
-- _custo_lista_canonica). NAO apaga public._bkp_custo_previsto e NAO mexe em nenhum valor gravado: os custos recalculados
-- ficam como estao. Devolver os custos de antes = passo SEPARADO e explicito
-- supabase/rollback/20261019310000_custo_previsto_restaurar.sql (autocontido; so com decisao do dono).
-- • Guarda: cada funcao, se existe, tem o texto da 20261019310000 (outra frente mexeu = recusa).
-- • Travas: so DROP FUNCTION (nenhuma tabela; sem DROP TRIGGER/POLICY). Idempotente (IF EXISTS).
-- • LIFO: roda ANTES dos inversos da 20261019300000 (volta passo 3, depois do 400000_down).
-- Aplicar fora de transacao (psql -v ON_ERROR_STOP=1 -f), com o client_encoding abaixo ANTES do BEGIN.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '8s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_lista_canonica(jsonb)',              '9fd76efb8850e54e9ad6bfba58a9e993'),
      ('public._custo_lista_hash(jsonb)',                  '926dea1a85ad86ab5663d7caf714980d'),
      ('public._custo_previa_lista()',                     '54368173a0aa69a60d3cb9c5d46a712a'),
      ('public._custo_backfill_rodar(jsonb,text,integer)', '5c4d71b0b5c1375280b429d44b9eb2ac')) x(assinatura, md5) LOOP
    IF to_regprocedure(r.assinatura) IS NOT NULL THEN
      v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
      IF v_md5 IS DISTINCT FROM r.md5 THEN
        RAISE EXCEPTION 'contas_certas_c2 (volta): % com outro texto (md5 %) - outra frente mexeu; conferir', r.assinatura, v_md5
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
END $guarda$;

DROP FUNCTION IF EXISTS public._custo_backfill_rodar(jsonb, text, integer);
DROP FUNCTION IF EXISTS public._custo_previa_lista();
DROP FUNCTION IF EXISTS public._custo_lista_hash(jsonb);
DROP FUNCTION IF EXISTS public._custo_lista_canonica(jsonb);

DO $pos$
BEGIN
  IF to_regprocedure('public._custo_backfill_rodar(jsonb,text,integer)') IS NOT NULL
     OR to_regprocedure('public._custo_previa_lista()') IS NOT NULL
     OR to_regprocedure('public._custo_lista_hash(jsonb)') IS NOT NULL
     OR to_regprocedure('public._custo_lista_canonica(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'contas_certas_c2 (volta): pos-condicao falhou - funcao da correcao unica ainda existe' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public._bkp_custo_previsto') IS NOT NULL THEN
    RAISE NOTICE 'contas_certas_c2 (volta): _bkp_custo_previsto MANTIDA (% linha(s)) - restaurar = rollback/20261019310000_custo_previsto_restaurar.sql, so com o dono',
      (SELECT count(*) FROM public._bkp_custo_previsto);
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
