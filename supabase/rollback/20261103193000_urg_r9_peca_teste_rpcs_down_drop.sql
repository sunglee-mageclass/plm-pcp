-- DROP opcional de supabase/migrations/20261103193000_urg_r9_peca_teste_rpcs.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 2 / R9b; Rulings 2, 7-12, 17, 20, 33) + spec-r9.md + revisao T1 (achados 1 e 6).
-- Rodar SO depois do _down (trava no texto da r9a - ou no NEUTRO da r9a, se o _down dela ja rodou -, wrappers no NEUTRO). RECUSA enquanto qualquer OUTRA
-- funcao de public citar uma das 7 (ex.: a 194000 viva). Apaga as 7 funcoes. Nenhum dado. Idempotente (2a vez so confere).
-- Trava (MEDIDA, mesma receita): ~25 ms (a guarda varre pg_proc), so catalogo (DROP FUNCTION das 7): nenhuma trava de tabela;
-- nada em auth/storage/realtime (o supautils nao prende nada em DROP FUNCTION). Site voltado; qualquer hora.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_peca_teste_trava_fornecedor()
--     ANTES  eda05ebed95f51f554afe210a5f28c89
--     DEPOIS 982769d4384a04d9a35d53db654667da
--   public._peca_teste_aprovada(uuid,uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 417fa9850a5a52204f62476818dc408c
--   public._peca_teste_trilhas_core(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 5ae0f7025744d63508d7617e6e3a7487
--   public.peca_teste_modelo(uuid) (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS 9f5e9a528d3cac6deaf3c34133f5d56b
--     NEUTRO 693da711ec898bdbbc078439ecd1c46e (_down)
--   public._salvar_peca_teste_core(uuid,jsonb,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS 9338a5f0a8ef2e072ad6031c5d2030c6
--   public.salvar_peca_teste(uuid,jsonb,jsonb) (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS 74edd9a64f98101476de545ac8361a81
--     NEUTRO 4c501cdcdbf99aed1da1aef6d82f853f (_down)
--   public._peca_teste_quadro_core(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 6e191644f2fb4acfea04e4ff76a6f5de
--     NEUTRO 1821c151ef5963eb95d90167c75ba249 (_down)
--   public.peca_teste_quadro() (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS ad45b8479fb46de11ea265b7ef5a728a
--     NEUTRO d208d91fc9846fd221da953481966968 (_down)
--   dependencias FIXADAS (nao redefinidas):
--     public._exige_modulos(text[]) b1d4958f65df2c593366926e2b56903e
--     public._seg_exige_pagina(text[]) 85eff0037e61fdecefb46154ac9479d2
--     public.user_can_view(text) 643c9aa7ef41d52e3193b1e1561e1375
--     public.enforce_servico_mo_aprovacao() 1643b69db26e2034905866356b80232e
--     public._modelo_colecao_rotulo(uuid,uuid,text) e9220bc3a67b82ddcd768b8ad5a81a46
-- ====================================================================================
-- Exemplo: psql -v ON_ERROR_STOP=1 -f supabase/rollback/20261103193000_urg_r9_peca_teste_rpcs_down_drop.sql
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
  -- o _down ja rodou: funcoes redefinidas no texto de ANTES (ou no NEUTRO do _down do bloco anterior, que roda antes dos _down_drop)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '4b41dd70f4751bd076f6468f2c001c23')
    ) AS x(f, a, alt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.alt) THEN
      RAISE EXCEPTION 'urg_r9b_down_drop: % nao esta no texto de ANTES (md5 %) - rode o 20261103193000_down antes', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes novas: ausentes (2a vez) ou no estado do _down (wrapper NEUTRO, core DEPOIS); wrapper ainda no DEPOIS ou com EXECUTE
  -- do authenticated = o _down nao rodou
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_aprovada(uuid,uuid,uuid)', '417fa9850a5a52204f62476818dc408c', '417fa9850a5a52204f62476818dc408c', false),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', '5ae0f7025744d63508d7617e6e3a7487', false),
      ('public.peca_teste_modelo(uuid)', '9f5e9a528d3cac6deaf3c34133f5d56b', '693da711ec898bdbbc078439ecd1c46e', true),
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', '9338a5f0a8ef2e072ad6031c5d2030c6', '9338a5f0a8ef2e072ad6031c5d2030c6', false),
      ('public.salvar_peca_teste(uuid,jsonb,jsonb)', '74edd9a64f98101476de545ac8361a81', '4c501cdcdbf99aed1da1aef6d82f853f', true),
      ('public._peca_teste_quadro_core(uuid)', '6e191644f2fb4acfea04e4ff76a6f5de', '1821c151ef5963eb95d90167c75ba249', false),
      ('public.peca_teste_quadro()', 'ad45b8479fb46de11ea265b7ef5a728a', 'd208d91fc9846fd221da953481966968', true)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.n AND v = r.d THEN
      RAISE EXCEPTION 'urg_r9b_down_drop: % ainda no texto da ida - rode o 20261103193000_down antes', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v IS NOT NULL AND v <> r.n THEN
      RAISE EXCEPTION 'urg_r9b_down_drop: % (nova) com texto inesperado (md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
    IF v IS NOT NULL AND has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION 'urg_r9b_down_drop: % ainda executavel pelo authenticated - rode o 20261103193000_down antes', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma OUTRA funcao de public cita as novas (ex.: a 194000 viva): rode os _down/_down_drop delas antes
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.oid NOT IN (coalesce(to_regprocedure('public._peca_teste_aprovada(uuid,uuid,uuid)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_trilhas_core(uuid,uuid)'), 0::oid), coalesce(to_regprocedure('public.peca_teste_modelo(uuid)'), 0::oid), coalesce(to_regprocedure('public._salvar_peca_teste_core(uuid,jsonb,jsonb)'), 0::oid), coalesce(to_regprocedure('public.salvar_peca_teste(uuid,jsonb,jsonb)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_quadro_core(uuid)'), 0::oid), coalesce(to_regprocedure('public.peca_teste_quadro()'), 0::oid))
     AND p.prosrc ~ '\y(_peca_teste_aprovada|_peca_teste_trilhas_core|peca_teste_modelo|_salvar_peca_teste_core|salvar_peca_teste|_peca_teste_quadro_core|peca_teste_quadro)\y';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r9b_down_drop: funcoes ainda citam as da 20261103193000: % - rode os _down/_down_drop delas antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- as funcoes novas, na ordem INVERSA da criacao (wrapper antes do core)
DROP FUNCTION IF EXISTS public.peca_teste_quadro();
DROP FUNCTION IF EXISTS public._peca_teste_quadro_core(uuid);
DROP FUNCTION IF EXISTS public.salvar_peca_teste(uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS public._salvar_peca_teste_core(uuid,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.peca_teste_modelo(uuid);
DROP FUNCTION IF EXISTS public._peca_teste_trilhas_core(uuid,uuid);
DROP FUNCTION IF EXISTS public._peca_teste_aprovada(uuid,uuid,uuid);

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regprocedure('public._peca_teste_aprovada(uuid,uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_trilhas_core(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.peca_teste_modelo(uuid)') IS NOT NULL
     OR to_regprocedure('public._salvar_peca_teste_core(uuid,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public.salvar_peca_teste(uuid,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_quadro_core(uuid)') IS NOT NULL
     OR to_regprocedure('public.peca_teste_quadro()') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r9b_down_drop: pos-condicao falhou (funcoes novas ainda existem)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '4b41dd70f4751bd076f6468f2c001c23')
    ) AS x(f, a, alt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.alt) THEN
      RAISE EXCEPTION 'urg_r9b_down_drop: pos-condicao falhou em % (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
