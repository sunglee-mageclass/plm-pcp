-- DROP opcional de supabase/migrations/20261103185000_urg_r5_peca_foto_previsao.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 3 / R5; Ruling 3).
-- Rodar SO depois do _down (salvar_terceirizados no texto de ANTES), com o SITE ja voltado, em HORARIO CALMO: DROP COLUMN
-- pega AccessExclusiveLock em producao_terceirizados ate o COMMIT - ate a LEITURA de servicos espera (MEDIDO na copia,
-- supautils carregado: ~2 ms; nada em auth/storage/realtime). As previsoes gravadas SE PERDEM. Guarda: salvar_terceirizados
-- no texto de ANTES, nenhuma funcao de public citando peca_foto_previsao e nenhuma view dependendo da coluna.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.salvar_terceirizados(uuid,jsonb,text,jsonb)
--     ANTES  fe2530878c26ae9a9680a7b1d02eca71
--     DEPOIS 388454fc81028e43d60878fa75132db2
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
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', 'fe2530878c26ae9a9680a7b1d02eca71')
    ) AS x(f, a) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.a THEN
      RAISE EXCEPTION 'urg_r5_down_drop: % nao esta no texto de ANTES (md5 %) - rode o 20261103185000_down antes', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma funcao de public le/grava a coluna (ex.: blocos posteriores ainda vivos) nem view depende dela
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ 'peca_foto_previsao';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r5_down_drop: funcoes ainda citam peca_foto_previsao: % - rode os _down antes', v USING ERRCODE = 'P0001';
  END IF;
  SELECT string_agg(DISTINCT w.ev_class::regclass::text, ', ') INTO v
    FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE d.refobjid = 'public.producao_terceirizados'::regclass AND a.attname = 'peca_foto_previsao';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r5_down_drop: views ainda dependem de peca_foto_previsao: %', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER TABLE public.producao_terceirizados DROP COLUMN IF EXISTS peca_foto_previsao;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'producao_terceirizados'
              AND column_name = 'peca_foto_previsao') THEN
    RAISE EXCEPTION 'urg_r5_down_drop: pos-condicao falhou (coluna peca_foto_previsao ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
