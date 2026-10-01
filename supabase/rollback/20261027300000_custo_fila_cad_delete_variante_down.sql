-- INVERSO (passo 1 de 2) de supabase/migrations/20261027300000_custo_fila_cad_delete_variante.sql (achados LEVES L5, C1 L4).
-- NEUTRALIZA fn_custo_fila_cad_del e fn_custo_fila_variante_tecido (CREATE OR REPLACE com RETURN NULL): apagar CAD e trocar
-- o artigo da variante voltam a NAO enfileirar o custo (como antes da L5). Os 2 gatilhos (cad.trg_custo_fila_del e
-- variantes_tecido.trg_custo_fila_upd) ficam de pe, inertes. Sem trava de tabela nem de auth/storage (so a trava de objeto
-- das funcoes): pode rodar a qualquer hora (e o freio de emergencia). O DROP fica no
-- 20261027300000_custo_fila_cad_delete_variante_down_drop.sql (SEPARADO, opcional, horario calmo).
-- Guarda: so roda se as 2 funcoes estao com o texto da ida (7a984643 / 5a57e42a); neutra/ausente/outro -> P0001 e nada muda.
-- Nada gravado muda: custo ja recalculado fica; o que estiver na fila segue para o processador da release 8 normalmente.
-- LIFO: roda ANTES das voltas da release 8 (20261019300000). Sem site a voltar.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_custo_fila_cad_del()', '7a98464376a1e4f60a1dc4da83bec516'),
      ('public.fn_custo_fila_variante_tecido()', '5a57e42a4b3595c2889e85c1c2823b0e')) v(s, depois) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l5 (volta): % nao existe - a 20261027300000 nao foi aplicada', r.s USING ERRCODE = 'P0001';
    END IF;
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.depois THEN
      RAISE EXCEPTION 'leves_l5 (volta): % nao esta com o texto da 20261027300000 (md5 %) - ja neutralizada ou outra frente mexeu',
        r.s, md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE TEMP TABLE _l5v_acl_antes ON COMMIT DROP AS
  SELECT s, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(s)) AS acl
    FROM unnest(ARRAY['public.fn_custo_fila_cad_del()', 'public.fn_custo_fila_variante_tecido()']) s;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_cad_del()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L5 NEUTRALIZADA] volta da 20261027300000 (supabase/rollback/20261027300000_custo_fila_cad_delete_variante_down.sql):
-- o gatilho trg_custo_fila_del de cad fica de pe, inerte (apagar CAD nao enfileira). DROP so no _down_drop (horario calmo).
BEGIN
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_variante_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L5 NEUTRALIZADA] volta da 20261027300000 (supabase/rollback/20261027300000_custo_fila_cad_delete_variante_down.sql):
-- o gatilho trg_custo_fila_upd de variantes_tecido fica de pe, inerte (trocar o artigo nao enfileira). DROP so no _down_drop.
BEGIN
  RETURN NULL;
END;
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_custo_fila_cad_del()', '9df86c53e45c99810ec4ba5ca120bedb'),
      ('public.fn_custo_fila_variante_tecido()', 'e92a84443182afee5ce356d70f24384d')) v(s, neutro) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.neutro THEN
      RAISE EXCEPTION 'leves_l5 (volta): pos-condicao falhou - % nao ficou neutra', r.s USING ERRCODE = 'P0001';
    END IF;
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.s))
       IS DISTINCT FROM (SELECT a.acl FROM _l5v_acl_antes a WHERE a.s = r.s) THEN
      RAISE EXCEPTION 'leves_l5 (volta): pos-condicao falhou - a ACL de % mudou', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_del' AND tgrelid = to_regclass('public.cad'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_upd' AND tgrelid = to_regclass('public.variantes_tecido')) THEN
    RAISE EXCEPTION 'leves_l5 (volta): os 2 gatilhos deviam continuar de pe (inertes)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
