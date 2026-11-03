-- DROP opcional de supabase/migrations/20261103199400_urg_r11_salvar_mini.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 4 / R11e; Rulings aceitos + RESPOSTAS DO DONO P-349/P-365/P-366).
-- Rodar SO depois do _down (cores da R9 de volta, _peca_teste_mini_aplicar NEUTRA) e ANTES dos _down_drop da 199300. RECUSA
-- enquanto qualquer OUTRA funcao de public citar _peca_teste_mini_aplicar/_peca_teste_trilha_mini. Apaga as 2 novas. Idempotente.
-- Trava (MEDIDA): DROP das 2 funcoes novas - SO catalogo; 0 em auth/storage/realtime. RECUSA enquanto outra funcao de public
--   citar alguma delas; rodar DEPOIS do _down. Os 2 cores da R9 ficam no texto de ANTES (o _down ja os devolveu).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._salvar_peca_teste_core(uuid,jsonb,jsonb)
--     ANTES  eccde92e1c6687045f8f7c9ae61caf8f
--     DEPOIS 3e3b9db2d04dd176a4712898293f8545
--   public._peca_teste_trilhas_core(uuid,uuid)
--     ANTES  5ae0f7025744d63508d7617e6e3a7487
--     DEPOIS ef860a61e25750d2d12131062a23202d
--   public._peca_teste_trilha_mini(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 348c7e9978e7f6c0a48812baccc65a5e
--   public._peca_teste_mini_aplicar(uuid,uuid,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS e6c43399f0a5c20c17c6255477947d2d
--     NEUTRO 2dbec37294d192919e72a0a9ae52ef7a (_down)
--   dependencias FIXADAS (nao redefinidas):
--     public._peca_teste_mini_baixar(uuid,jsonb) 444861eae9b28bc09ec3bfd80bc01033
--     public._peca_teste_mini_estornar(uuid) c8f160a73b3a30a6105c7a45aff9c89d
--     public._peca_teste_mini_linhas(uuid,text,uuid,jsonb) 3d73d0db8fc0902c5bd07edfbfa2fe70
--     public._peca_teste_mini_tem_historico(uuid) 10c05fae5041077c6dc23436d66f7d44
-- ====================================================================================
-- Exemplo: psql -v ON_ERROR_STOP=1 -f supabase/rollback/20261103199400_urg_r11_salvar_mini_down_drop.sql
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
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e1c6687045f8f7c9ae61caf8f', 'eccde92e1c6687045f8f7c9ae61caf8f'),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', '5ae0f7025744d63508d7617e6e3a7487')
    ) AS x(f, a, alt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.alt) THEN
      RAISE EXCEPTION 'urg_r11e_down_drop: % nao esta no texto de ANTES (md5 %) - rode o 20261103199400_down antes', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes novas: ausentes (2a vez) ou no estado do _down (wrapper NEUTRO, core DEPOIS); wrapper ainda no DEPOIS ou com EXECUTE
  -- do authenticated = o _down nao rodou
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_trilha_mini(uuid)', '348c7e9978e7f6c0a48812baccc65a5e', '348c7e9978e7f6c0a48812baccc65a5e', false),
      ('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)', 'e6c43399f0a5c20c17c6255477947d2d', '2dbec37294d192919e72a0a9ae52ef7a', false)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.n AND v = r.d THEN
      RAISE EXCEPTION 'urg_r11e_down_drop: % ainda no texto da ida - rode o 20261103199400_down antes', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v IS NOT NULL AND v <> r.n THEN
      RAISE EXCEPTION 'urg_r11e_down_drop: % (nova) com texto inesperado (md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
    IF v IS NOT NULL AND has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION 'urg_r11e_down_drop: % ainda executavel pelo authenticated - rode o 20261103199400_down antes', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma OUTRA funcao de public cita as novas (ex.: a 194000 viva): rode os _down/_down_drop delas antes
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.oid NOT IN (coalesce(to_regprocedure('public._peca_teste_trilha_mini(uuid)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)'), 0::oid))
     AND p.prosrc ~ '\y(_peca_teste_trilha_mini|_peca_teste_mini_aplicar)\y';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11e_down_drop: funcoes ainda citam as da 20261103199400: % - rode os _down/_down_drop delas antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- as funcoes novas, na ordem INVERSA da criacao (wrapper antes do core)
DROP FUNCTION IF EXISTS public._peca_teste_mini_aplicar(uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public._peca_teste_trilha_mini(uuid);

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regprocedure('public._peca_teste_trilha_mini(uuid)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_mini_aplicar(uuid,uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11e_down_drop: pos-condicao falhou (funcoes novas ainda existem)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_peca_teste_core(uuid,jsonb,jsonb)', 'eccde92e1c6687045f8f7c9ae61caf8f', 'eccde92e1c6687045f8f7c9ae61caf8f'),
      ('public._peca_teste_trilhas_core(uuid,uuid)', '5ae0f7025744d63508d7617e6e3a7487', '5ae0f7025744d63508d7617e6e3a7487')
    ) AS x(f, a, alt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.alt) THEN
      RAISE EXCEPTION 'urg_r11e_down_drop: pos-condicao falhou em % (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
