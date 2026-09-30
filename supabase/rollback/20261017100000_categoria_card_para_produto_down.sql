-- INVERSO de supabase/migrations/20261017100000_categoria_card_para_produto.sql (P-137 A).
-- Derruba o gatilho trg_modelo_espelho_categoria e a funcao fn_modelo_espelho_categoria: a Categoria/Subcategorias do
-- card voltam a NAO ir para o produto (comportamento anterior). NAO desfaz dados ja copiados enquanto o gatilho esteve
-- no ar (igual ao espelho de Nome: o dado copiado e o do card, que continua la).
-- • PASSO 2 de 2 (horario calmo). O passo 1 de emergencia, sem lock em modelos, e o
--   20261017100000_categoria_card_para_produto_down_neutraliza.sql (troca o corpo da funcao por um no-op).
-- • Guarda: so roda se a funcao viva tem o texto da 20261017100000 (ATIVA) ou o neutralizado (passo 1) e o gatilho a
--   definicao dela; ambos ausentes = nada a desfazer (NOTICE, no-op); outro texto -> P0001.
-- • Guarda LIFO: o backfill 20261017110000 depende deste gatilho — se _bkp_p137_backfill ainda existe, PARE (rode antes
--   o inverso do backfill, supabase/rollback/20261017110000_categoria_card_para_produto_backfill_down.sql).
-- • Lock (R4 do G-plano): DROP TRIGGER pede ACCESS EXCLUSIVE em modelos — enquanto espera na fila bloqueia ate as
--   LEITURAS de modelos. Por isso: lock_timeout 500ms + ate 3 tentativas SO em 55P03 (lock_not_available), horario calmo.
--   A funcao so e derrubada depois do gatilho (DROP FUNCTION nao trava modelos).
-- • LIFO: esta volta roda DEPOIS do inverso do backfill (20261017110000) e ANTES dos inversos da release 5
--   (20261016100000 / 20261015100000 / 20261014100000).
-- Aplicar fora de transacao (psql -v ON_ERROR_STOP=1 -f), com o client_encoding abaixo ANTES do BEGIN.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '10s';

DO $guarda$
DECLARE
  v_md5 text;
  v_trg text;
BEGIN
  IF to_regclass('public._bkp_p137_backfill') IS NOT NULL THEN
    RAISE EXCEPTION 'p137 (volta): o backfill 20261017110000 ainda esta aplicado (_bkp_p137_backfill existe) - rode antes o inverso dele (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()')));
  SELECT md5(pg_get_triggerdef(t.oid)) INTO v_trg FROM pg_trigger t
   WHERE t.tgname = 'trg_modelo_espelho_categoria' AND t.tgrelid = 'public.modelos'::regclass;
  IF v_md5 IS NULL AND v_trg IS NULL THEN
    RAISE NOTICE 'p137 (volta): gatilho e funcao ausentes - nada a desfazer';
    RETURN;
  END IF;
  -- aceita a funcao ATIVA (texto da 20261017100000) ou NEUTRALIZADA (passo 1, _down_neutraliza.sql)
  IF v_md5 NOT IN ('ea9edd59c5ec5eff207336dbe06a3499', 'bb13fa0c820f96463b877f89f8e1085b') THEN
    RAISE EXCEPTION 'p137 (volta): fn_modelo_espelho_categoria nem ativa nem neutralizada (md5 %) - outra frente mexeu', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF v_trg IS NOT NULL AND v_trg IS DISTINCT FROM '871039e642390c357188b6b2a1134d64' THEN
    RAISE EXCEPTION 'p137 (volta): trg_modelo_espelho_categoria com outra definicao (md5 %) - outra frente mexeu', v_trg USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- DROP TRIGGER: ate 3 tentativas, SO em 55P03 (lock_not_available); qualquer outro erro sobe na hora.
DO $volta$
DECLARE
  i int;
BEGIN
  FOR i IN 1..3 LOOP
    BEGIN
      EXECUTE 'DROP TRIGGER IF EXISTS trg_modelo_espelho_categoria ON public.modelos';
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 3 THEN
        RAISE;
      END IF;
      RAISE NOTICE 'p137 (volta): modelos ocupada (tentativa % de 3) - tentando de novo em 1s', i;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END $volta$;

DROP FUNCTION IF EXISTS public.fn_modelo_espelho_categoria();

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_modelo_espelho_categoria')
     OR to_regprocedure('public.fn_modelo_espelho_categoria()') IS NOT NULL THEN
    RAISE EXCEPTION 'p137 (volta): pos-condicao falhou - gatilho ou funcao ainda existem' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'::regprocedure))
     IS DISTINCT FROM 'e5473bb29fa559408093d1a82c6ac11f' THEN
    RAISE EXCEPTION 'p137 (volta): pos-condicao falhou - _salvar_produto_acabado_core mudou' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
