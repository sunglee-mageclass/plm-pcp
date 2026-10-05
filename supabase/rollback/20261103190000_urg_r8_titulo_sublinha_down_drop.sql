-- DROP opcional de supabase/migrations/20261103190000_urg_r8_titulo_sublinha.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 4 / R8a; Rulings 16, 17, 23).
-- Rodar SO depois do _down (as 3 funcoes no texto de ANTES): DROP do helper _integracao_titulo_sublinha. So catalogo (nenhuma
-- trava de tabela). Guarda: as 3 funcoes no texto de ANTES e nenhuma outra funcao de public citando o helper.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._integracao_retrato_core(uuid,text[],jsonb)
--     ANTES  8a5275cf8c145f88e23c5158c22fdfc6
--     DEPOIS 2635e1833654111858a301f7ef06ccf1
--   public.integracao_listar(text,jsonb,integer,integer)
--     ANTES  d2d3c9c55b3a6ce8b42d1842cab415f6
--     DEPOIS 5fd15e4b95fc5555e055935a67af62e8
--   public._integracao_exemplo(text[],integer)
--     ANTES  8882ce651fe5f13a44c60751692da40e
--     DEPOIS d57b40f96cc4a4fdbb2f9dc0ddc6c8d7
--   public._integracao_titulo_sublinha(text,text,text,text) (NOVA)
--     ANTES  ausente
--     DEPOIS a847a61f50f4b72608aa10edaa7ac0c9
-- ====================================================================================
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
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '8a5275cf8c145f88e23c5158c22fdfc6'),
      ('public.integracao_listar(text,jsonb,integer,integer)', 'd2d3c9c55b3a6ce8b42d1842cab415f6'),
      ('public._integracao_exemplo(text[],integer)', '8882ce651fe5f13a44c60751692da40e')
    ) AS x(f, a) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.a THEN
      RAISE EXCEPTION 'urg_r8a_down_drop: % nao esta no texto de ANTES (md5 %) - rode o 20261103190000_down antes', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma OUTRA funcao de public chama o helper (ex.: o reprocesso r8b ainda vivo)
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname <> '_integracao_titulo_sublinha'
     AND p.prosrc ~ '_integracao_titulo_sublinha';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r8a_down_drop: funcoes ainda citam _integracao_titulo_sublinha: % - rode os _down antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._integracao_titulo_sublinha(text, text, text, text);

DO $pos$
BEGIN
  IF to_regprocedure('public._integracao_titulo_sublinha(text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r8a_down_drop: pos-condicao falhou (_integracao_titulo_sublinha ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
