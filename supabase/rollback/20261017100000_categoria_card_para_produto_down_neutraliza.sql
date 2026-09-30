-- VOLTA DE EMERGENCIA da 20261017100000 (P-137 A) — PASSO 1 de 2: NEUTRALIZA o gatilho sem travar modelos.
-- Troca o corpo de fn_modelo_espelho_categoria por um que nao faz nada (RETURN NEW; num gatilho AFTER o retorno e
-- ignorado). O gatilho trg_modelo_espelho_categoria continua existindo, mas a Categoria/Subcategorias do card deixam de
-- ir para o produto NA HORA. CREATE OR REPLACE FUNCTION so mexe na linha de pg_proc: NAO pede lock em public.modelos
-- (nem leitura nem escrita de cards espera) — conferido no $pos$ (pg_locks deste backend sem modelos) e na prova da copia.
-- PASSO 2 (horario calmo): supabase/rollback/20261017100000_categoria_card_para_produto_down.sql derruba gatilho e
-- funcao (ACCESS EXCLUSIVE em modelos) — ele aceita a funcao ativa OU esta neutralizada.
-- • Guarda: funcao com o texto ATIVO da 20261017100000 ou ja neutralizada (reaplicar = no-op); ausente = nada a fazer;
--   outro texto -> P0001. NAO depende do backfill (pode rodar com ele aplicado; o inverso do backfill continua valendo).
-- • Religar: reaplicar supabase/migrations/20261017100000_categoria_card_para_produto.sql (a guarda dela aceita esta).
-- • Nao desfaz dado ja copiado pelo gatilho (igual ao inverso completo).
-- Aplicar fora de transacao (psql -v ON_ERROR_STOP=1 -f), com o client_encoding abaixo ANTES do BEGIN.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()')));
  IF v_md5 IS NULL THEN
    RAISE EXCEPTION 'p137 (neutraliza): fn_modelo_espelho_categoria ausente - nada a neutralizar (a volta completa ja rodou?)' USING ERRCODE = 'P0001';
  END IF;
  IF v_md5 NOT IN ('ea9edd59c5ec5eff207336dbe06a3499', 'bb13fa0c820f96463b877f89f8e1085b') THEN
    RAISE EXCEPTION 'p137 (neutraliza): fn_modelo_espelho_categoria com outro texto (md5 %) - outra frente mexeu', v_md5 USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_modelo_espelho_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- P-137 NEUTRALIZADA (volta de emergencia, passo 1): o gatilho segue ligado mas nao copia nada para o produto.
  RETURN NEW;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_modelo_espelho_categoria() FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()')));
  IF v_md5 IS DISTINCT FROM 'bb13fa0c820f96463b877f89f8e1085b' THEN
    RAISE EXCEPTION 'p137 (neutraliza): pos-condicao falhou - funcao nao ficou neutralizada (md5 %)', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = pg_backend_pid() AND l.relation = 'public.modelos'::regclass) THEN
    RAISE EXCEPTION 'p137 (neutraliza): pos-condicao falhou - esta transacao pegou lock em public.modelos' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public.fn_modelo_espelho_categoria()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.fn_modelo_espelho_categoria()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_modelo_espelho_categoria()', 'EXECUTE') THEN
    RAISE EXCEPTION 'p137 (neutraliza): pos-condicao falhou - EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
