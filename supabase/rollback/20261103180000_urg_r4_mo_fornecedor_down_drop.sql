-- DROP opcional de supabase/migrations/20261103180000_urg_r4_mo_fornecedor.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 1 / R4a; Rulings 1 e 2).
-- Rodar SO depois do _down (as 3 funcoes no texto de ANTES), com o SITE ja voltado, em HORARIO CALMO: DROP COLUMN pega
-- AccessExclusiveLock em modelo_servico_mo E em empresas (a FK sai junto; MEDIDO na copia: ~1 ms, nada em auth/storage)
-- ate o COMMIT - ate a LEITURA de empresas espera. Os fornecedores gravados nas linhas SE PERDEM. Guarda: as 3 funcoes no
-- texto de ANTES e nenhuma funcao de public citando modelo_servico_mo + empresa_id.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_modelo_servico_mo_core(uuid,jsonb)
--     ANTES  540d04a79171518731a1b084c7976cb7
--     DEPOIS 4d13d632ae2c5b931632e93536ae2ddd
--   public.enforce_servico_mo_aprovacao()
--     ANTES  a2115ce0538b76b7cbe1740a6227bd2e
--     DEPOIS 1643b69db26e2034905866356b80232e
--   public._modelo_mo_resumo_core(uuid[])
--     ANTES  13b124236df405b9b3843da7a6071b63
--     DEPOIS f1bdb88458e469eb24c3e6f58b3ce870
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
      ('public._salvar_modelo_servico_mo_core(uuid,jsonb)', '540d04a79171518731a1b084c7976cb7'),
      ('public.enforce_servico_mo_aprovacao()', 'a2115ce0538b76b7cbe1740a6227bd2e'),
      ('public._modelo_mo_resumo_core(uuid[])', '13b124236df405b9b3843da7a6071b63')
    ) AS x(f, a) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.a THEN
      RAISE EXCEPTION 'urg_r4a_down_drop: % nao esta no texto de ANTES (md5 %) - rode o 20261103180000_down antes', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma outra funcao de public le/grava modelo_servico_mo.empresa_id (ex.: blocos posteriores ainda vivos)
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ 'modelo_servico_mo' AND p.prosrc ~ 'empresa_id';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r4a_down_drop: funcoes ainda citam modelo_servico_mo/empresa_id: % - rode os _down antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER TABLE public.modelo_servico_mo DROP COLUMN IF EXISTS empresa_id;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelo_servico_mo'
              AND column_name = 'empresa_id') THEN
    RAISE EXCEPTION 'urg_r4a_down_drop: pos-condicao falhou (coluna empresa_id ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
