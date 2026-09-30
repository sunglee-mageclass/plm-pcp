-- FREIO DE EMERGENCIA de supabase/migrations/20261019300000_custo_previsto_servidor.sql (contas certas C1; plano
-- .superpowers/sdd/2026-09-30-contas-certas-cd/plan-cd.md §4 C1 + R2). So CREATE OR REPLACE FUNCTION: NAO pega trava em
-- tabela nenhuma (nem em login/storage) - pode rodar a qualquer hora.
-- Efeito: os gatilhos continuam la, mas nao fazem nada:
--   - as funcoes de fila (fn_custo_fila_*) viram RETURN NULL e _custo_enfileirar vira RETURN (ninguem entra na fila);
--   - o processador fn_custo_processar_fila vira no-op (o que sobrou na fila fica parado; nada e recalculado);
--   - fn_modelo_custo_derivado vira RETURN NEW (o cliente volta a gravar custo_peca_previsto/custo_*_total, como antes).
-- NAO mexe em valores gravados (o custo recalculado ate aqui fica). NAO mexe em precos_tecido_congelado (o embrulho da
-- RC1 da o MESMO resultado que o texto de antes; ele volta no _down.sql). O ACL (EXECUTE revogado) e mantido pelo
-- CREATE OR REPLACE.
-- Depois, em horario calmo: supabase/rollback/20261019300000_custo_previsto_servidor_down.sql (DISABLE TRIGGER + devolve o
-- texto de precos_tecido_congelado) e, opcional e separado, o _down_drop.sql. Reaplicar a migration desfaz este freio.
-- Ordem geral: LIFO da APLICACAO (o site volta ANTES ou junto). Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _cc_c1_neutro (assinatura text, md5_depois text, md5_neutro text) ON COMMIT DROP;
INSERT INTO _cc_c1_neutro VALUES
  ('public._custo_enfileirar(uuid[],boolean)',  '46add076c0cad5f3df2e9417159aae66',    '5db568ca49628eb2ed2e2cdf3c40afd7'),
  ('public.fn_custo_processar_fila()',          '186821db6c25a3344817e78cfae74e29',   'e1ce39bcdbb607fe74ce887ab8d5b15c'),
  ('public.fn_custo_fila_por_modelo()',         'f4ae106c44af7759106d23223e56c677',    'e062138f732e9ddf18cfe3e382e9b9b0'),
  ('public.fn_custo_fila_por_modelo_tecido()',  '627ae4106dd610c339f413914bd5ac4c',   '15a053aef51fe9d18f8cd4ed60248dd7'),
  ('public.fn_custo_fila_preco()',              'cd405a624d82e23f0ce8120472f04471', 'c511be3920624e989008b9e628aaaa2e'),
  ('public.fn_custo_fila_cad()',                '382a1d5e86635d0bf9d2a114ca0b0a97',   '96077ec208a85505521ed98e5b745acf'),
  ('public.fn_custo_fila_modelo()',             'f1c2ba13e1d00d3344d7ebd16a12fce3',   '11c173d40243a20d0f9c292a4f57e525'),
  ('public.fn_modelo_custo_derivado()',         '8a1bb256740d5aa1a4f2084adc007587',  '9181312787be6e450371e1e80b039441');

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM _cc_c1_neutro LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_c1 (freio): % nao existe - a 20261019300000 nao esta aplicada', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5_depois AND v_md5 IS DISTINCT FROM r.md5_neutro THEN
      RAISE EXCEPTION 'contas_certas_c1 (freio): % com texto inesperado (md5 %) - conferir antes de neutralizar', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._custo_enfileirar(_ids uuid[], _respeitar_congelado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: ninguem entra na fila de custo.
BEGIN
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_processar_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: o processador nao recalcula nada.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_por_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_por_modelo_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_preco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: nao enfileira.
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_modelo_custo_derivado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1 NEUTRALIZADO] volta da 20261019300000: o cliente volta a gravar o custo previsto (como antes).
BEGIN
  RETURN NEW;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM _cc_c1_neutro LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5_neutro THEN
      RAISE EXCEPTION 'contas_certas_c1 (freio): % nao ficou neutralizada (md5 %)', r.assinatura, v_md5 USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.assinatura, 'EXECUTE') OR has_function_privilege('authenticated', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'contas_certas_c1 (freio): % ficou executavel por anon/authenticated', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
