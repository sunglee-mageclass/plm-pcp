-- Reforço de segurança — sub-release S3d ("Planejamento, produtos, Plan. Tecido e importação"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3d.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.6, §2.7, §3, §5, §6 S3d); plano: plan.md (P-231 = D2 A).
-- Gatilho trg_aaa_seg_pagina em modelos (BEFORE INSERT/UPDATE/DELETE: INSERT/DELETE = Planejamento; UPDATE = Planejamento OU
-- Desenvolvimento; UPDATE so de mix_id = tambem Plan. Tecido/Produto Acabado/Produto Importado; a GUC app.explosao_sistema
-- da S1 passa) e em produtos_acabados/produtos_importados (BEFORE UPDATE: a pagina do produto OU o Planejamento). Funcoes
-- SECURITY INVOKER que so mordem current_user authenticated/anon. modelos e a tabela mais quente: CREATE TRIGGER com
-- lock_timeout curto e ate 3 tentativas; HORARIO CALMO. Exige o helper da S3a.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_modelos() (NOVA)
--     ANTES  ausente
--     DEPOIS f2e6579a764661ed6be0afe643050c6d
--     NEUTRA 382c59774ba779b27fcf2ebc6a0901be (o _down)
--   public.fn_seg_pagina_produtos_acabados() (NOVA)
--     ANTES  ausente
--     DEPOIS d3faa369eeccc8759cb1ca1c195bde1c
--     NEUTRA ab09f88a63e984fea51b9d6a5f3bccea (o _down)
--   public.fn_seg_pagina_produtos_importados() (NOVA)
--     ANTES  ausente
--     DEPOIS 854fefdd5519e875d5f2f6c947d086ae
--     NEUTRA 151187e6ad8c8c6ea168602b103185db (o _down)
-- ====================================================================================
-- ⚠️ Trava: CREATE TRIGGER = ShareRowExclusive em modelos (a tabela mais QUENTE: bloqueia escrita, não leitura, até o
-- COMMIT), produtos_acabados e produtos_importados — medido em seg-s3d.test.ts; nada em auth/storage. Cada CREATE TRIGGER
-- espera até 1500ms (cancela autovacuum) e tenta 3×; o resto é catálogo. HORÁRIO CALMO (madrugada). Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101210000_seg_s3d_guarda_modelos_down.sql (LIFO: 20261101210000_down → 200000_down → 190000_down, ANTES dos inversos da S3c/S3b/S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3d-report.md, seção "Cadeia md5").
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._seg_exige_pagina(text[])'))) IS DISTINCT FROM '85eff0037e61fdecefb46154ac9479d2' THEN
    RAISE EXCEPTION 's3d_guarda: rode antes a S3a 20261101100000 (_seg_exige_pagina ausente ou com texto inesperado)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelos()', 'f2e6579a764661ed6be0afe643050c6d', '382c59774ba779b27fcf2ebc6a0901be', 'modelos', 31),
      ('public.fn_seg_pagina_produtos_acabados()', 'd3faa369eeccc8759cb1ca1c195bde1c', 'ab09f88a63e984fea51b9d6a5f3bccea', 'produtos_acabados', 19),
      ('public.fn_seg_pagina_produtos_importados()', '854fefdd5519e875d5f2f6c947d086ae', '151187e6ad8c8c6ea168602b103185db', 'produtos_importados', 19)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3d_guarda: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3d_guarda: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
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

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_modelos() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_produtos_acabados()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3d] (Reforco de seguranca S3d, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em produtos_acabados.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina; inclusive os gatilhos de preco, espelho,
-- custo, kanban, REF, Integracao, versao e rev), CASCADE de FK, migrations/psql e service_role passam. Gatilho
-- trg_aaa_seg_pagina: roda ANTES dos outros BEFORE (ordem alfabetica; o set_tenant_id_trg do INSERT vem antes).
-- O cliente so tem UPDATE em mix_id e modelo_id (grant por coluna, 20261101200000); TAM-1: tamanho_tipo so pelas RPCs.
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  PERFORM public._seg_exige_pagina('criacao_produto_acabado', 'criacao_planejamento');  -- mix_id (Editar Familia) / modelo_id (espelho do Sheet)
  RETURN NEW;
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_produtos_acabados() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_produtos_importados()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3d] (Reforco de seguranca S3d, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em produtos_importados.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina; inclusive os gatilhos de preco, espelho,
-- custo, kanban, REF, Integracao, versao e rev), CASCADE de FK, migrations/psql e service_role passam. Gatilho
-- trg_aaa_seg_pagina: roda ANTES dos outros BEFORE (ordem alfabetica; o set_tenant_id_trg do INSERT vem antes).
-- O cliente so tem UPDATE em mix_id e modelo_id (grant por coluna, 20261101200000); TAM-1: tamanho_tipo so pelas RPCs.
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  PERFORM public._seg_exige_pagina('criacao_produto_importado', 'criacao_planejamento');  -- mix_id (Editar Familia) / modelo_id (espelho do Sheet)
  RETURN NEW;
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_produtos_importados() FROM PUBLIC, anon, authenticated;

-- modelos é a tabela mais quente: até 3 tentativas (cada uma num sub-bloco; a trava só fica na que der certo). Cada espera vai
-- até 1500ms — acima do deadlock_timeout (1s), que é quando o Postgres CANCELA um autovacuum/analyze que segura modelos (medido
-- na cópia: com 500ms o autovacuum de modelos nunca era cancelado e o CREATE TRIGGER falhava 3×). Depois volta aos 500ms.
DO $trg$
DECLARE
  i int;
BEGIN
  PERFORM set_config('lock_timeout', '1500ms', true);
  FOR i IN 1..3 LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.modelos'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.modelos
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_modelos();
      END IF;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  FOR i IN 1..3 LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.produtos_acabados'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_pagina BEFORE UPDATE ON public.produtos_acabados
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_produtos_acabados();
      END IF;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  FOR i IN 1..3 LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.produtos_importados'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                      AND NOT t.tgisinternal) THEN
        CREATE TRIGGER trg_aaa_seg_pagina BEFORE UPDATE ON public.produtos_importados
          FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_produtos_importados();
      END IF;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
  PERFORM set_config('lock_timeout', '500ms', true);
END
$trg$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelos()', 'f2e6579a764661ed6be0afe643050c6d', '382c59774ba779b27fcf2ebc6a0901be', 'modelos', 31),
      ('public.fn_seg_pagina_produtos_acabados()', 'd3faa369eeccc8759cb1ca1c195bde1c', 'ab09f88a63e984fea51b9d6a5f3bccea', 'produtos_acabados', 19),
      ('public.fn_seg_pagina_produtos_importados()', '854fefdd5519e875d5f2f6c947d086ae', '151187e6ad8c8c6ea168602b103185db', 'produtos_importados', 19)
    ) AS x(f, d, n, t, tt) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 's3d_guarda: pos-condicao falhou em %', r.f USING ERRCODE = 'P0001';
    END IF;
    -- tgtype 31 = ROW(1)+BEFORE(2)+INSERT(4)+DELETE(8)+UPDATE(16); 19 = ROW+BEFORE+UPDATE; sem colunas, sem WHEN; ligado ('O')
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                    AND t.tgfoid = to_regprocedure(r.f) AND t.tgtype = r.tt AND t.tgenabled = 'O'
                    AND t.tgqual IS NULL AND t.tgattr::text = '') THEN
      RAISE EXCEPTION 's3d_guarda: pos-condicao falhou no gatilho de %', r.t USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3d_guarda: pos-condicao falhou em % (EXECUTE ou SECURITY DEFINER)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
