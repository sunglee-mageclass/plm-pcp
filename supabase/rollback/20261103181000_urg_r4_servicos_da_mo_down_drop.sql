-- DROP opcional de supabase/migrations/20261103181000_urg_r4_servicos_da_mo.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 2 / R4b; Rulings 4-9, 12, 22 + B2 da revisao da Task 1).
-- Rodar SO depois do _down (as 2 chamadoras no texto de ANTES), com o SITE ja voltado, em HORARIO CALMO: DROP das 2 funcoes
-- novas, do indice e da coluna. DROP COLUMN pega AccessExclusiveLock em producao_terceirizados E em modelo_servico_mo (a FK
-- sai junto) ate o COMMIT - ate a LEITURA de servicos e de linhas de M.O. espera (MEDIDO na copia, supautils carregado:
-- DROP INDEX + DROP COLUMN ~2 ms; nada em auth/storage/realtime). O vinculo bloco -> linha de M.O. SE PERDE (os blocos
-- ficam). Guarda: as 2 chamadoras no texto de ANTES e nenhuma outra funcao de public citando as novas ou mo_linha_id.
-- Rodar ANTES do _down_drop da r4a (180000) e do 20261103100000_down_drop da Modularidade.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._enviar_modelo_para_cad_core(uuid,text,text)
--     ANTES  bf28796bcd86538a3a5b516e9cf356c6
--     DEPOIS 47488eabb37b6ee180e17740269bebd5
--   public._aprovar_servico_mo_core(uuid,uuid,boolean,text)
--     ANTES  859dd63992e86cc75b7abeab41dee954
--     DEPOIS 5ce4cc9e8696b1495e8248eccce3f8d3
--   public._servicos_da_mo_criar(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 92c0edd9037824726acadab8afc80648
--   public._servico_mo_preencher_preco(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS f8c56394f5adb07c7a42378978d77aa0
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
      ('public._enviar_modelo_para_cad_core(uuid,text,text)', 'bf28796bcd86538a3a5b516e9cf356c6'),
      ('public._aprovar_servico_mo_core(uuid,uuid,boolean,text)', '859dd63992e86cc75b7abeab41dee954')
    ) AS x(f, a) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.a THEN
      RAISE EXCEPTION 'urg_r4b_down_drop: % nao esta no texto de ANTES (md5 %) - rode o 20261103181000_down antes', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma OUTRA funcao de public chama as 2 novas nem le/grava producao_terceirizados.mo_linha_id
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname NOT IN ('_servicos_da_mo_criar', '_servico_mo_preencher_preco')
     AND p.prosrc ~ '(_servicos_da_mo_criar|_servico_mo_preencher_preco|mo_linha_id)';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r4b_down_drop: funcoes ainda citam as funcoes novas/mo_linha_id: % - rode os _down antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP FUNCTION IF EXISTS public._servicos_da_mo_criar(uuid, uuid);
DROP FUNCTION IF EXISTS public._servico_mo_preencher_preco(uuid);
DROP INDEX IF EXISTS public.producao_terceirizados_mo_linha_idx;
ALTER TABLE public.producao_terceirizados DROP COLUMN IF EXISTS mo_linha_id;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'producao_terceirizados'
              AND column_name = 'mo_linha_id')
     OR to_regprocedure('public._servicos_da_mo_criar(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public._servico_mo_preencher_preco(uuid)') IS NOT NULL
     OR to_regclass('public.producao_terceirizados_mo_linha_idx') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r4b_down_drop: pos-condicao falhou (coluna/indice/funcoes ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
