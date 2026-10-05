-- DROP opcional das 2 funcoes NOVAS de supabase/migrations/20261103175000_urg_r2_insumos_iniciais.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a2.mjs (nunca editar a mao).
-- Rodar SO depois do 20261103175000_down (as 2 no texto NEUTRO) e com o SITE ja voltado. Apaga public.salvar_insumos_iniciais(uuid,jsonb) e
-- public._insumos_padrao_aplicar(uuid). Guarda: nenhuma OUTRA funcao de public cita as 2 (varre o prosrc, inclusive comentarios). Nenhum dado se
-- perde (linhas de insumo ja gravadas ficam). Trava: SO catalogo (DROP FUNCTION; nenhuma tabela). Vem ANTES do _down_drop da
-- 20261103174000 (LIFO).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._insumos_padrao_aplicar(uuid)', 'fa0d3ce7bb39628db1a6d33c46f4d289'),
      ('public.salvar_insumos_iniciais(uuid,jsonb)', '9a0c13cdab6ca7720c6669b964faa052')
    ) AS x(fn, neutro) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.fn)));
    IF v IS NOT NULL AND v <> r.neutro THEN
      RAISE EXCEPTION 'urg_r2_175000_down_drop: % nao esta no texto neutro (md5 %) - rode o 20261103175000_down antes', r.fn, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.oid NOT IN (coalesce(to_regprocedure('public._insumos_padrao_aplicar(uuid)'), 0), coalesce(to_regprocedure('public.salvar_insumos_iniciais(uuid,jsonb)'), 0))
     AND p.prosrc ~ '_insumos_padrao_aplicar|salvar_insumos_iniciais';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r2_175000_down_drop: funcoes ainda citam as funcoes da 175000: % - rode o _down antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public.salvar_insumos_iniciais(uuid,jsonb);
DROP FUNCTION IF EXISTS public._insumos_padrao_aplicar(uuid);

DO $pos$
BEGIN
  IF to_regprocedure('public.salvar_insumos_iniciais(uuid,jsonb)') IS NOT NULL OR to_regprocedure('public._insumos_padrao_aplicar(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r2_175000_down_drop: pos-condicao falhou (funcao ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
