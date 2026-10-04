-- Reforço de segurança — sub-release S3b ("Produção, Expedição e Explosão"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3b.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.3-2.4, §3, §6 S3b); plano: plan.md (P-231 = D2 A; P-245 = A).
-- Gatilho de PAGINA na escrita DIRETA (§1.2): trg_aaa_seg_pagina em cad (BEFORE UPDATE, POR COLUNA: direcionamento_* =
-- Direcionamento; sem_acabamento = PCP Servicos; observacoes_molde = Oficina OU PCP Servicos), controle_qualidade (BEFORE
-- UPDATE: fotografado_variantes = Lancamentos) e producao_oficina (BEFORE INSERT/UPDATE/DELETE: Oficina). Funcoes SECURITY
-- INVOKER que so mordem current_user authenticated/anon. Exige o helper da S3a (20261101100000).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_cad() (NOVA)
--     ANTES  ausente
--     DEPOIS ebe2e35d3f617c3de27304294553c4ba
--     NEUTRA a8576e43dacb0bb3d280f86eb22f5a15 (o _down)
--   public.fn_seg_pagina_controle_qualidade() (NOVA)
--     ANTES  ausente
--     DEPOIS 95a0241d7ec2691c49e3a87a89ab2ed8
--     NEUTRA 21f12cc9d8e0175456233c1c32ec2ab2 (o _down)
--   public.fn_seg_pagina_producao_oficina() (NOVA)
--     ANTES  ausente
--     DEPOIS f852373524c41e60c117148b6ffc87e0
--     NEUTRA 468a65bc549fcc0dd7106be99205cbb6 (o _down)
-- ====================================================================================
-- Trava: CREATE TRIGGER = ShareRowExclusive SÓ em cad, controle_qualidade e producao_oficina, por um instante cada (não
-- trava auth/storage — medido na C4/S2); o resto é catálogo. Horário calmo (Produção/Expedição). Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101150000_seg_s3b_guarda_producao_down.sql (LIFO: 20261101150000_down → 140000_down → 130000_down, ANTES dos inversos da S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3b-report.md, seção "Cadeia md5").
-- lock_timeout 1500ms (> deadlock_timeout: cancela autovacuum). 55P03 = nada mudou; rodar o arquivo de novo (até 3x, horário calmo).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._seg_exige_pagina(text[])'))) IS DISTINCT FROM '85eff0037e61fdecefb46154ac9479d2' THEN
    RAISE EXCEPTION 's3b_guarda: rode antes a S3a 20261101100000 (_seg_exige_pagina ausente ou com texto inesperado)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_cad()', 'ebe2e35d3f617c3de27304294553c4ba', 'a8576e43dacb0bb3d280f86eb22f5a15', 'cad', 19),
      ('public.fn_seg_pagina_controle_qualidade()', '95a0241d7ec2691c49e3a87a89ab2ed8', '21f12cc9d8e0175456233c1c32ec2ab2', 'controle_qualidade', 19),
      ('public.fn_seg_pagina_producao_oficina()', 'f852373524c41e60c117148b6ffc87e0', '468a65bc549fcc0dd7106be99205cbb6', 'producao_oficina', 31)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3b_guarda: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3b_guarda: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3b] (Reforco de seguranca S3b, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em cad.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina; inclusive os gatilhos de rev/rebaixa/#Erro/
-- Grade Cortada), CASCADE de FK, migrations/psql e service_role passam. Gatilho trg_aaa_seg_pagina: roda ANTES dos outros BEFORE.
-- POR COLUNA: o cliente so tem UPDATE em direcionamento_status, direcionamento_confirmado_at, sem_acabamento e observacoes_molde
-- (grant por coluna, 20261101140000); INSERT/DELETE so pelo servidor.
DECLARE
  v_dir boolean;
  v_sem boolean;
  v_molde boolean;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  v_dir := NEW.direcionamento_status IS DISTINCT FROM OLD.direcionamento_status
        OR NEW.direcionamento_confirmado_at IS DISTINCT FROM OLD.direcionamento_confirmado_at;
  v_sem := NEW.sem_acabamento IS DISTINCT FROM OLD.sem_acabamento;
  v_molde := NEW.observacoes_molde IS DISTINCT FROM OLD.observacoes_molde;
  IF v_dir THEN
    PERFORM public._seg_exige_pagina('producao_direcionamento');                     -- C-05 Desmarcar do Direcionamento
  END IF;
  IF v_sem THEN
    PERFORM public._seg_exige_pagina('producao_terceirizados');                      -- C-03 "Sem acabamento" do PCP Servicos
  END IF;
  IF v_molde THEN
    PERFORM public._seg_exige_pagina('producao_oficina', 'producao_terceirizados');  -- C-04 "Partes do Molde" (Oficina/Servicos)
  END IF;
  RETURN NEW;
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_cad() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_controle_qualidade()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3b] (Reforco de seguranca S3b, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em controle_qualidade.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina; inclusive os gatilhos de rev/rebaixa/#Erro/
-- Grade Cortada), CASCADE de FK, migrations/psql e service_role passam. Gatilho trg_aaa_seg_pagina: roda ANTES dos outros BEFORE.
-- O cliente so tem UPDATE em fotografado_variantes (grant por coluna); o resto do CQ so pelas RPCs (salvar_cq/_pos...).
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF NEW.fotografado_variantes IS DISTINCT FROM OLD.fotografado_variantes THEN
    PERFORM public._seg_exige_pagina('producao_lancamentos');                       -- C-11 fotografado (Lancamentos)
  END IF;
  RETURN NEW;
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_controle_qualidade() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_producao_oficina()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3b] (Reforco de seguranca S3b, P-231 = D2 A) permissao de PAGINA para a escrita DIRETA da tela/API em producao_oficina.
-- SECURITY INVOKER de proposito: so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST). Funcoes do
-- servidor (SECURITY DEFINER, dono postgres - cada RPC ja confere a propria pagina; inclusive os gatilhos de rev/rebaixa/#Erro/
-- Grade Cortada), CASCADE de FK, migrations/psql e service_role passam. Gatilho trg_aaa_seg_pagina: roda ANTES dos outros BEFORE.
-- A tela da Oficina grava o formulario inteiro direto (INSERT/UPDATE); DELETE so pelo servidor (grant).
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM public._seg_exige_pagina('producao_oficina');
  RETURN COALESCE(NEW, OLD);
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_producao_oficina() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.cad'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE UPDATE ON public.cad
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_cad();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.controle_qualidade'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE UPDATE ON public.controle_qualidade
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_controle_qualidade();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.producao_oficina'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.producao_oficina
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_producao_oficina();
  END IF;
END
$trg$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_cad()', 'ebe2e35d3f617c3de27304294553c4ba', 'a8576e43dacb0bb3d280f86eb22f5a15', 'cad', 19),
      ('public.fn_seg_pagina_controle_qualidade()', '95a0241d7ec2691c49e3a87a89ab2ed8', '21f12cc9d8e0175456233c1c32ec2ab2', 'controle_qualidade', 19),
      ('public.fn_seg_pagina_producao_oficina()', 'f852373524c41e60c117148b6ffc87e0', '468a65bc549fcc0dd7106be99205cbb6', 'producao_oficina', 31)
    ) AS x(f, d, n, t, tt) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 's3b_guarda: pos-condicao falhou em %', r.f USING ERRCODE = 'P0001';
    END IF;
    -- tgtype 19 = ROW(1)+BEFORE(2)+UPDATE(16); 31 = + INSERT(4) + DELETE(8); sem colunas, sem WHEN; ligado ('O')
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                    AND t.tgfoid = to_regprocedure(r.f) AND t.tgtype = r.tt AND t.tgenabled = 'O'
                    AND t.tgqual IS NULL AND t.tgattr::text = '') THEN
      RAISE EXCEPTION 's3b_guarda: pos-condicao falhou no gatilho de %', r.t USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3b_guarda: pos-condicao falhou em % (EXECUTE ou SECURITY DEFINER)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
