-- Volta da migration 20261201110000 (Regerar REF por card). So derruba as 4 funcoes NOVAS (nenhum dado, nenhuma tabela, nenhum gatilho;
-- sem trava alem do catalogo). SITE ANTES (o site novo chama as RPCs). Dados que NAO voltam sozinhos: REFs/SKUs ja regerados (ficam como
-- gravados; a trilha esta no audit_log do card - "Editou Modelo": ref de/para).
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261201110000_regerar_ref_card_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._regerar_ref_calcular(uuid)', '382e55959a003939511a4d680c3694ea'),
      ('public.ref_regerar_previa(uuid)', 'a79248834da577bc39201794069df617'),
      ('public._regerar_ref_card_core(uuid,text,boolean,text)', 'c1f0262ac0af4f84520beb6a7ea0d233'),
      ('public.regerar_ref_card(uuid,text,boolean,text)', '81f788a22e55c8dd0bd9a85417e75c22')) AS t(sig, esperado) LOOP
    IF to_regprocedure(r.sig) IS NOT NULL THEN
      v_md5 := md5(pg_get_functiondef(to_regprocedure(r.sig)));
      IF v_md5 <> r.esperado THEN
        RAISE EXCEPTION 'regerar_ref_down: % com texto diferente do da ida (md5 %) - nao derrubo', r.sig, v_md5 USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
END
$guarda$;

DROP FUNCTION IF EXISTS public.regerar_ref_card(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public._regerar_ref_card_core(uuid, text, boolean, text);
DROP FUNCTION IF EXISTS public.ref_regerar_previa(uuid);
DROP FUNCTION IF EXISTS public._regerar_ref_calcular(uuid);

COMMIT;

select pg_notify('pgrst', 'reload schema');
