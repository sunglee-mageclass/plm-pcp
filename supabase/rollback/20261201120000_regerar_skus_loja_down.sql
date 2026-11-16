-- Volta da migration 20261201120000 (Regerar todos os SKUs da loja). So derruba as 5 funcoes NOVAS (nenhum dado, nenhuma tabela, nenhum
-- gatilho; sem trava alem do catalogo). SITE ANTES (o site novo chama as RPCs). Dados que NAO voltam sozinhos: SKUs ja regerados em lote
-- (ficam como gravados; a trilha de/para por produto esta no audit_log, acao 'regerar_skus_loja' - permite reverter a mao).
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261201120000_regerar_skus_loja_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._regerar_guarda_admin(uuid)', 'f8431bd9b874c035c1c5ebf4b9bfdf53'),
      ('public._regerar_skus_item_core(uuid)', '8309ee03bd88ca9714bf8843b990db35'),
      ('public.regerar_skus_loja_previa(uuid,uuid,integer)', '4299c09d6ee71f7b9922d3443792e3ee'),
      ('public._regerar_skus_aplicar_item(uuid,uuid,text)', '87cc663f1a60b460973ff0fd0526033b'),
      ('public.regerar_skus_loja_aplicar(uuid,jsonb)', '90bed8b60f62326056025ec451a33ceb')) AS t(sig, esperado) LOOP
    IF to_regprocedure(r.sig) IS NOT NULL THEN
      v_md5 := md5(pg_get_functiondef(to_regprocedure(r.sig)));
      IF v_md5 <> r.esperado THEN
        RAISE EXCEPTION 'regerar_loja_down: % com texto diferente do da ida (md5 %) - nao derrubo', r.sig, v_md5 USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
END
$guarda$;

DROP FUNCTION IF EXISTS public.regerar_skus_loja_aplicar(uuid, jsonb);
DROP FUNCTION IF EXISTS public._regerar_skus_aplicar_item(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.regerar_skus_loja_previa(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public._regerar_skus_item_core(uuid);
DROP FUNCTION IF EXISTS public._regerar_guarda_admin(uuid);

COMMIT;

select pg_notify('pgrst', 'reload schema');
