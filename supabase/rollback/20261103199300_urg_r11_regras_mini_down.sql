-- Inverso NEUTRO de supabase/migrations/20261103199300_urg_r11_regras_mini.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 3 / R11d; Rulings 4,5,6,7,8,9,13) + espelho TS src/lib/peca-teste-mini.ts.
-- NEUTRO: o wrapper peca_teste_mini_estoque vira NULL (sem portoes) e perde o EXECUTE do authenticated; os 9 cores FICAM
-- (inertes; a baixa/estorno so rodam pela 199400). Idempotente. Remover de fato = _down_drop.
-- Trava (MEDIDA, mesma receita): o wrapper vira NEUTRO (CREATE OR REPLACE) + REVOKE do authenticated - SO catalogo;
--   0 em auth/storage/realtime. Idempotente.
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
  -- funcoes NOVAS deste bloco: presentes, com o texto de DEPOIS ou o NEUTRO (2a vez) - o _down nao as cria
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
    IF v IS NULL THEN
      RAISE EXCEPTION 'urg_r11d_down: % ausente - a 20261103199300 nao foi aplicada aqui (ou o _down_drop ja rodou)', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r11d_down: % (nova) com texto inesperado (md5 %) - outra frente mexeu', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) funcoes EXISTENTES de volta ao texto de ANTES
-- 2) wrappers NOVOS no texto NEUTRO (inertes; nao citam os portoes nem a tabela)
CREATE OR REPLACE FUNCTION public.peca_teste_mini_estoque(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [urg r11d] NEUTRA (_down da 199300): o wrapper de leitura devolve NULL e NAO cita portoes/tabelas (libera os _down_drop da
  -- Modularidade/S3a). Perde o EXECUTE do authenticated. Remover de fato = _down_drop.
  SELECT NULL::jsonb
$function$;

-- 3) wrappers NOVOS sem o EXECUTE do authenticated (o _down_drop apaga)
REVOKE EXECUTE ON FUNCTION public.peca_teste_mini_estoque(uuid) FROM authenticated;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
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
    IF v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 'urg_r11d_down: pos-condicao falhou em % (nova; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.n USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public'
                     AND coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x), '') = CASE WHEN r.w AND false THEN 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres' ELSE 'postgres=X/postgres,service_role=X/postgres' END)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (r.w AND false)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11d_down: pos-condicao falhou na ACL/secdef/search_path de % (nova)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
