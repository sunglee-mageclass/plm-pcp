-- DROP opcional de supabase/migrations/20261103199300_urg_r11_regras_mini.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 3 / R11d; Rulings 4,5,6,7,8,9,13) + espelho TS src/lib/peca-teste-mini.ts.
-- Rodar SO depois do _down (wrapper no NEUTRO) e depois dos _down/_down_drop da 199400. RECUSA enquanto qualquer OUTRA funcao
-- de public citar uma das 10. Apaga as 10 funcoes (ordem inversa: wrapper antes dos cores). Nenhum dado. Idempotente.
-- Trava (MEDIDA): DROP das 10 funcoes - SO catalogo; 0 em auth/storage/realtime. RECUSA enquanto outra funcao de public citar
--   alguma delas (ex.: a 199400 viva); rodar DEPOIS do _down e dos _down/_down_drop da 199400. Horario calmo nao e exigido.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 5dae1386c608628edcd6f8362ba996e7
--   public._peca_teste_insumo_tam_bucket(uuid,text) (NOVA)
--     ANTES  ausente
--     DEPOIS cabea631702567f1e3a5199e8a272746
--   public._peca_teste_mini_linhas(uuid,text,uuid,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS 3d73d0db8fc0902c5bd07edfbfa2fe70
--   public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text) (NOVA)
--     ANTES  ausente
--     DEPOIS e03a4d616e7ae297386a5e0e6bb83ff7
--   public._peca_teste_mini_baixar(uuid,jsonb) (NOVA)
--     ANTES  ausente
--     DEPOIS 444861eae9b28bc09ec3bfd80bc01033
--   public._peca_teste_mini_estornar(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS c8f160a73b3a30a6105c7a45aff9c89d
--   public._peca_teste_mini_tem_historico(uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 10c05fae5041077c6dc23436d66f7d44
--   public._peca_teste_mini_feita(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS f81421e9b3aa27f34ab426f6b0783f96
--   public._peca_teste_mini_estoque_core(uuid,uuid) (NOVA)
--     ANTES  ausente
--     DEPOIS 2a3527c28b3486d5f86587d9af169f72
--   public.peca_teste_mini_estoque(uuid) (NOVA, wrapper)
--     ANTES  ausente
--     DEPOIS 8a1d492a40993a582b7978080a1fff2d
--     NEUTRO a94ba498dee379436f45577f790a5b8d (_down)
--   dependencias FIXADAS (nao redefinidas):
--     public._estoque_aviamento_core(uuid) 439093c8501001c17e71f283b1dcef92
--     public._estoque_etiqueta_core(uuid) de6eeb18e1e15cf8137a6560e451fa0f
--     public._insumo_tamanho_de(uuid) 46fd6f65599f7de2d3ab12777fefa7d1
-- ====================================================================================
-- Exemplo: psql -v ON_ERROR_STOP=1 -f supabase/rollback/20261103199300_urg_r11_regras_mini_down_drop.sql
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
  -- funcoes novas: ausentes (2a vez) ou no estado do _down (wrapper NEUTRO, core DEPOIS); wrapper ainda no DEPOIS ou com EXECUTE
  -- do authenticated = o _down nao rodou
  FOR r IN SELECT * FROM (VALUES
      ('public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid)', '5dae1386c608628edcd6f8362ba996e7', '5dae1386c608628edcd6f8362ba996e7', false),
      ('public._peca_teste_insumo_tam_bucket(uuid,text)', 'cabea631702567f1e3a5199e8a272746', 'cabea631702567f1e3a5199e8a272746', false),
      ('public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)', '3d73d0db8fc0902c5bd07edfbfa2fe70', '3d73d0db8fc0902c5bd07edfbfa2fe70', false),
      ('public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text)', 'e03a4d616e7ae297386a5e0e6bb83ff7', 'e03a4d616e7ae297386a5e0e6bb83ff7', false),
      ('public._peca_teste_mini_baixar(uuid,jsonb)', '444861eae9b28bc09ec3bfd80bc01033', '444861eae9b28bc09ec3bfd80bc01033', false),
      ('public._peca_teste_mini_estornar(uuid)', 'c8f160a73b3a30a6105c7a45aff9c89d', 'c8f160a73b3a30a6105c7a45aff9c89d', false),
      ('public._peca_teste_mini_tem_historico(uuid)', '10c05fae5041077c6dc23436d66f7d44', '10c05fae5041077c6dc23436d66f7d44', false),
      ('public._peca_teste_mini_feita(uuid,uuid)', 'f81421e9b3aa27f34ab426f6b0783f96', 'f81421e9b3aa27f34ab426f6b0783f96', false),
      ('public._peca_teste_mini_estoque_core(uuid,uuid)', '2a3527c28b3486d5f86587d9af169f72', '2a3527c28b3486d5f86587d9af169f72', false),
      ('public.peca_teste_mini_estoque(uuid)', '8a1d492a40993a582b7978080a1fff2d', 'a94ba498dee379436f45577f790a5b8d', true)
    ) AS x(f, d, n, w) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.n AND v = r.d THEN
      RAISE EXCEPTION 'urg_r11d_down_drop: % ainda no texto da ida - rode o 20261103199300_down antes', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v IS NOT NULL AND v <> r.n THEN
      RAISE EXCEPTION 'urg_r11d_down_drop: % (nova) com texto inesperado (md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
    IF v IS NOT NULL AND has_function_privilege('authenticated', r.f, 'EXECUTE') THEN
      RAISE EXCEPTION 'urg_r11d_down_drop: % ainda executavel pelo authenticated - rode o 20261103199300_down antes', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma OUTRA funcao de public cita as novas (ex.: a 194000 viva): rode os _down/_down_drop delas antes
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.oid NOT IN (coalesce(to_regprocedure('public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_insumo_tam_bucket(uuid,text)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_mini_baixar(uuid,jsonb)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_mini_estornar(uuid)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_mini_tem_historico(uuid)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_mini_feita(uuid,uuid)'), 0::oid), coalesce(to_regprocedure('public._peca_teste_mini_estoque_core(uuid,uuid)'), 0::oid), coalesce(to_regprocedure('public.peca_teste_mini_estoque(uuid)'), 0::oid))
     AND p.prosrc ~ '\y(_peca_teste_variante_aviamento_padrao|_peca_teste_insumo_tam_bucket|_peca_teste_mini_linhas|_peca_teste_tecido_baixar|_peca_teste_mini_baixar|_peca_teste_mini_estornar|_peca_teste_mini_tem_historico|_peca_teste_mini_feita|_peca_teste_mini_estoque_core|peca_teste_mini_estoque)\y';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11d_down_drop: funcoes ainda citam as da 20261103199300: % - rode os _down/_down_drop delas antes', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- as funcoes novas, na ordem INVERSA da criacao (wrapper antes do core)
DROP FUNCTION IF EXISTS public.peca_teste_mini_estoque(uuid);
DROP FUNCTION IF EXISTS public._peca_teste_mini_estoque_core(uuid,uuid);
DROP FUNCTION IF EXISTS public._peca_teste_mini_feita(uuid,uuid);
DROP FUNCTION IF EXISTS public._peca_teste_mini_tem_historico(uuid);
DROP FUNCTION IF EXISTS public._peca_teste_mini_estornar(uuid);
DROP FUNCTION IF EXISTS public._peca_teste_mini_baixar(uuid,jsonb);
DROP FUNCTION IF EXISTS public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text);
DROP FUNCTION IF EXISTS public._peca_teste_mini_linhas(uuid,text,uuid,jsonb);
DROP FUNCTION IF EXISTS public._peca_teste_insumo_tam_bucket(uuid,text);
DROP FUNCTION IF EXISTS public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid);

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regprocedure('public._peca_teste_variante_aviamento_padrao(uuid,uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_insumo_tam_bucket(uuid,text)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_mini_linhas(uuid,text,uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_tecido_baixar(uuid,uuid,uuid,text,integer,integer,uuid,numeric,boolean,uuid,text)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_mini_baixar(uuid,jsonb)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_mini_estornar(uuid)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_mini_tem_historico(uuid)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_mini_feita(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public._peca_teste_mini_estoque_core(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('public.peca_teste_mini_estoque(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11d_down_drop: pos-condicao falhou (funcoes novas ainda existem)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
