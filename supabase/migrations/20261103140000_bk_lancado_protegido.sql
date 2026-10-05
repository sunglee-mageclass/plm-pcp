-- Backend B1 — modelos.lancado so muda pelo servidor (desenho item 1). GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk1.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-05-backend/plan.md (§2 B1, §0 K1, §13; Rulings R1).
-- O que muda (troca de texto EXATA sobre o texto vivo; nada mais na funcao de gatilho):
--   fn_seg_pagina_modelos (gatilho trg_aaa_seg_pagina de modelos, BEFORE INSERT/UPDATE/DELETE, SECURITY INVOKER, so morde
--     current_user authenticated/anon) ganha, logo depois do RETURN para quem nao e cliente e ANTES do atalho da GUC
--     app.explosao_sistema: INSERT com lancado = true, ou UPDATE que muda lancado (inclusive para NULL) =
--     42501 'lancado_protegido: ...' (ASCII; a tela traduz em erro-mensagem.ts, mensagemBackend).
--   Os 4 escritores legitimos (lancar_modelo, fn_rebaixa_lancado_cq, _reverter_corte_tecido_core,
--     _voltar_cq_para_servico_core) sao SECURITY DEFINER (rodam como postgres) e passam sem mudanca. Sem JWT
--     (migration/psql) e service_role tambem passam. Funcao NOVA que grave lancado TEM de ser DEFINER (anti-drift
--     tests/integration/bk-1-lancado.test.ts).
-- Gatilho, ACL, SECURITY INVOKER e search_path ficam iguais (guarda/pos-condicao). Nenhum objeto novo (sem _down_drop).
-- Nenhum dado muda.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_modelos()  [B1 (plano §2, K1)]
--     ANTES  f2e6579a764661ed6be0afe643050c6d
--     DEPOIS 490ad56b650ed59547fb61545f77dfd5
--   dependencias fixadas: public._seg_exige_pagina(text[]) = 85eff0037e61fdecefb46154ac9479d2
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 1 funcao de gatilho): nenhuma tabela (o gatilho NAO e recriado),
-- nada de auth/storage/realtime. Sem DROP, sem CREATE/DROP TRIGGER/POLICY. Idempotente (a guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261103140000_bk_lancado_protegido_down.sql (LIFO: depois do inverso da B2 141000 e antes dos inversos da Modularidade;
-- e ANTES de qualquer inverso antigo que guarde esta funcao por md5: S3d 20261101210000_down/_down_drop - ver md5-bk1.txt).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
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
      ('public.fn_seg_pagina_modelos()', 'f2e6579a764661ed6be0afe643050c6d', '490ad56b650ed59547fb61545f77dfd5')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'bk1_lancado_protegido: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._seg_exige_pagina(text[])', '85eff0037e61fdecefb46154ac9479d2')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk1_lancado_protegido: dependencia % com texto inesperado (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- o gatilho que chama a funcao e o de hoje (BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW, ligado)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelos()', 'modelos', 'trg_aaa_seg_pagina', 31)
    ) AS x(f, t, g, tt) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = to_regclass('public.' || r.t) AND g.tgname = r.g
                     AND NOT g.tgisinternal AND g.tgfoid = to_regprocedure(r.f) AND g.tgenabled = 'O' AND g.tgtype = r.tt) THEN
      RAISE EXCEPTION 'bk1_lancado_protegido: gatilho % de % ausente ou diferente', r.g, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- a coluna existe e e boolean (o texto novo le NEW.lancado/OLD.lancado)
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.modelos'::regclass AND a.attname = 'lancado'
                   AND NOT a.attisdropped AND a.atttypid = 'boolean'::regtype) THEN
    RAISE EXCEPTION 'bk1_lancado_protegido: modelos.lancado ausente ou nao boolean' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_modelos()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3d] (Reforco de seguranca S3d, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em modelos.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina; inclusive os gatilhos de preco, espelho,
-- custo, kanban, REF, Integracao, versao e rev), CASCADE de FK, migrations/psql e service_role passam. Gatilho
-- trg_aaa_seg_pagina: roda ANTES dos outros BEFORE (ordem alfabetica; o set_tenant_id_trg do INSERT vem antes).
-- INSERT/DELETE = Planejamento; UPDATE = Planejamento OU Desenvolvimento; UPDATE que muda SO o mix_id = tambem Plan. Tecido,
-- Produto Acabado e Produto Importado. As regras de COLUNA que ja existem (preco/preco_anterior/enviado_cad/custo derivado/
-- Integracao/REF) seguem nos gatilhos delas.
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- [backend B1] modelos.lancado so muda pelo servidor: lancar_modelo, desmarcar o CQ (fn_rebaixa_lancado_cq), reverter o corte e
  -- voltar o CQ ao servico - todos SECURITY DEFINER (rodam como postgres e nem chegam aqui). Cliente (PostgREST) que cria card ja
  -- lancado ou muda o lancado = 42501. Antes do atalho da GUC da Explosao de proposito (nenhuma INVOKER grava lancado).
  IF (TG_OP = 'INSERT' AND coalesce(NEW.lancado, false))
     OR (TG_OP = 'UPDATE' AND NEW.lancado IS DISTINCT FROM OLD.lancado) THEN
    RAISE EXCEPTION 'lancado_protegido: use o botao Lancar do card' USING ERRCODE = '42501';
  END IF;
  -- voltar_modelo_desenvolvimento (Explosao, a unica INVOKER que grava modelos) roda com a GUC da S1: ja conferiu a pagina dela.
  IF TG_OP = 'UPDATE' AND coalesce(current_setting('app.explosao_sistema', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP IN ('INSERT', 'DELETE') THEN
    PERFORM public._seg_exige_pagina('criacao_planejamento');                      -- card novo, Duplicar, criar em massa, Excluir
  ELSIF (to_jsonb(NEW) - 'mix_id') = (to_jsonb(OLD) - 'mix_id') THEN
    -- so a familia (mix_id): Plan. Tecido (C-01) e o EditarMixDialog do Produto Acabado/Importado tambem movem o card
    PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento', 'criacao_plan_tecido', 'criacao_produto_acabado', 'criacao_produto_importado');
  ELSE
    PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento');  -- Sheet, Ordem, BulkEdit, preco, "Mover para", arraste
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelos()', '490ad56b650ed59547fb61545f77dfd5', '{postgres=X/postgres,service_role=X/postgres}', false, 'search_path=public')
    ) AS x(f, m, acl, sd, cfg) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk1_lancado_protegido: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND p.proconfig = ARRAY[r.cfg])
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'bk1_lancado_protegido: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
