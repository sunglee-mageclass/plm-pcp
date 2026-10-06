-- Inverso NEUTRO de supabase/migrations/20261103193000_urg_r9_peca_teste_rpcs.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 2 / R9b; Rulings 2, 7-12, 17, 20, 33) + spec-r9.md + revisao T1 (achados 1 e 6).
-- NEUTRO: a trava volta ao texto da r9a (eda05ebe); os 3 wrappers (leitura = NULL/[]; Salvar = P0001 funcao_desativada) e o
-- core do quadro ([]) viram texto NEUTRO que NAO cita os portoes nem o rotulo da colecao (libera os _down_drop da
-- Modularidade/S3a) e os wrappers perdem o EXECUTE do authenticated. As 7 funcoes FICAM (os outros 3 cores com o mesmo texto).
-- Idempotente (2a vez = no-op). Remover de fato = _down_drop (opcional).
-- Trava (MEDIDA, mesma receita): ~3 ms, so catalogo (CREATE OR REPLACE da trava + REVOKE): nenhuma trava de tabela; nada em
-- auth/storage/realtime. Qualquer hora.
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
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '982769d4384a04d9a35d53db654667da')
    ) AS x(f, a, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.d) THEN
      RAISE EXCEPTION 'urg_r9b_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes NOVAS deste bloco: presentes, com o texto de DEPOIS ou o NEUTRO (2a vez) - o _down nao as cria
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
    IF v IS NULL THEN
      RAISE EXCEPTION 'urg_r9b_down: % ausente - a 20261103193000 nao foi aplicada aqui (ou o _down_drop ja rodou)', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r9b_down: % (nova) com texto inesperado (md5 %) - outra frente mexeu', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- 1) funcoes EXISTENTES de volta ao texto de ANTES
CREATE OR REPLACE FUNCTION public.fn_peca_teste_trava_fornecedor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9a] P-312/spec: peca aprovada trava o fornecedor da tentativa = o da linha de M.O. (vale p/ o Salvar da M.O. e da Peca Teste).
  -- So morde com o tipo ainda exigindo peca teste (switch desligado = trilha escondida, nada travado).
  IF EXISTS (SELECT 1 FROM public.categorias_terceirizado c WHERE c.id = OLD.categoria_terceirizado_id AND c.exige_peca_teste)
     AND (SELECT t.aprovacao FROM public.modelo_peca_teste_tentativas t
           WHERE t.mo_linha_id = OLD.id AND t.categoria_terceirizado_id = OLD.categoria_terceirizado_id
           ORDER BY t.numero DESC LIMIT 1) = 'aprovado' THEN
    RAISE EXCEPTION 'peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;

-- 2) wrappers NOVOS no texto NEUTRO (inertes; nao citam os portoes nem a tabela)
CREATE OR REPLACE FUNCTION public.peca_teste_modelo(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] NEUTRA (_down da 20261103193000): sem secao Peca Teste; o _down_drop apaga.
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.salvar_peca_teste(_modelo_id uuid, _trilhas jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] NEUTRA (_down da 20261103193000): desativada; o _down_drop apaga.
  RAISE EXCEPTION 'funcao_desativada: salvar_peca_teste' USING ERRCODE = 'P0001';
END $function$;

CREATE OR REPLACE FUNCTION public._peca_teste_quadro_core(_tenant uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] NEUTRA (_down da 20261103193000): sem a coluna alimentada pelo card; nao cita o helper do rotulo da colecao da
  -- Modularidade (libera o _down_drop da Mod T3); o _down_drop apaga.
  RETURN '[]'::jsonb;
END $function$;

CREATE OR REPLACE FUNCTION public.peca_teste_quadro()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9b] NEUTRA (_down da 20261103193000): quadro sem a coluna alimentada pelo card; o _down_drop apaga.
  RETURN '[]'::jsonb;
END $function$;

-- 3) wrappers NOVOS sem o EXECUTE do authenticated (o _down_drop apaga)
REVOKE EXECUTE ON FUNCTION public.peca_teste_modelo(uuid), public.salvar_peca_teste(uuid,jsonb,jsonb), public.peca_teste_quadro() FROM authenticated;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '{postgres=X/postgres,service_role=X/postgres}', false, true)
    ) AS x(f, m, acl, w, sd) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r9b_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM r.w
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9b_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
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
    IF v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 'urg_r9b_down: pos-condicao falhou em % (nova; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.n USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND p.prosecdef
                     AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public'
                     AND coalesce((SELECT string_agg(x::text, ',' ORDER BY x::text) FROM unnest(p.proacl) x), '') = CASE WHEN r.w AND false THEN 'authenticated=X/postgres,postgres=X/postgres,service_role=X/postgres' ELSE 'postgres=X/postgres,service_role=X/postgres' END)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE') IS DISTINCT FROM (r.w AND false)
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9b_down: pos-condicao falhou na ACL/secdef/search_path de % (nova)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
