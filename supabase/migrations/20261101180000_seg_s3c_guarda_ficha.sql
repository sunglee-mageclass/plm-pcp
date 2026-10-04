-- Reforço de segurança — sub-release S3c ("Ficha técnica, CAD, M.O. e B3"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3c.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.5, §2.7 B3, §5, §6 S3c); plano: plan.md (P-231 = D2 A; P-244 = B).
-- Gatilho trg_aaa_seg_pagina (BEFORE INSERT/UPDATE/DELETE) em modelo_etiquetas (pagina Desenvolvimento) e modelo_observacoes
-- (Desenvolvimento OU PCP Servicos, C-07): pagina so para current_user authenticated/anon (SECURITY INVOKER); B3 em QUALQUER
-- escrita: modelo_id/etiqueta_id/cor_id da MESMA loja da linha (P0001 'loja_diferente: <coluna>'). Exige o helper da S3a.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_seg_pagina_modelo_etiquetas() (NOVA)
--     ANTES  ausente
--     DEPOIS 7e8cb620cd8c697d068bc712e5f2c0df
--     NEUTRA 2930cab11f9b2836e2005cf0229f9754 (o _down)
--   public.fn_seg_pagina_modelo_observacoes() (NOVA)
--     ANTES  ausente
--     DEPOIS 649719a1ac1b14f87fdf07bab66aa8f1
--     NEUTRA 63076d0418d076f0799a58cb48e78eb3 (o _down)
-- ====================================================================================
-- Trava: CREATE TRIGGER = ShareRowExclusive SÓ em modelo_etiquetas e modelo_observacoes, por um instante cada (não
-- trava auth/storage — medido na C4/S2); o resto é catálogo. Horário calmo (Estilo & Engenharia). Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101180000_seg_s3c_guarda_ficha_down.sql (LIFO: 20261101180000_down → 170000_down → 160000_down, ANTES dos inversos da S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3c-report.md, seção "Cadeia md5").
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
    RAISE EXCEPTION 's3c_guarda: rode antes a S3a 20261101100000 (_seg_exige_pagina ausente ou com texto inesperado)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelo_etiquetas()', '7e8cb620cd8c697d068bc712e5f2c0df', '2930cab11f9b2836e2005cf0229f9754', 'modelo_etiquetas', 31),
      ('public.fn_seg_pagina_modelo_observacoes()', '649719a1ac1b14f87fdf07bab66aa8f1', '63076d0418d076f0799a58cb48e78eb3', 'modelo_observacoes', 31)
    ) AS x(f, d, n, t, tt) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF (v IS NOT NULL AND v NOT IN (r.d, r.n)) THEN
      RAISE EXCEPTION 's3c_guarda: % com texto inesperado (md5 %) - outra frente mexeu', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                AND NOT t.tgisinternal AND t.tgfoid IS DISTINCT FROM to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3c_guarda: trg_aaa_seg_pagina em % aponta para outra funcao', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_modelo_etiquetas()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3c] (Reforco de seguranca S3c, P-231 = D2 A + B3) escrita DIRETA da tela/API em modelo_etiquetas.
-- PAGINA: SECURITY INVOKER de proposito - so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST); funcoes
-- do servidor (SECURITY DEFINER), CASCADE de FK, migrations/psql e service_role passam.
-- B3 (loja): vale para QUALQUER escrita (cliente e servidor) - INSERT, ou UPDATE que mude as colunas de vinculo -> P0001
-- 'loja_diferente: <coluna>'. Roda depois do set_tenant_id_trg (ordem alfabetica), entao tenant_id ja vem preenchido.
-- Etiquetas/insumos do BOM: o Salvar da ficha (Sheet do Planejamento, secao travada sem EDITAR o Desenvolvimento) grava direto.
DECLARE
  v_loja uuid;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.modelo_id IS DISTINCT FROM OLD.modelo_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.etiqueta_id IS DISTINCT FROM OLD.etiqueta_id
     OR NEW.cor_id IS DISTINCT FROM OLD.cor_id THEN
    SELECT m.tenant_id INTO v_loja FROM public.modelos m WHERE m.id = NEW.modelo_id;
    IF v_loja IS NULL OR (NEW.tenant_id IS NOT NULL AND NEW.tenant_id <> v_loja) THEN
      RAISE EXCEPTION 'loja_diferente: modelo_id' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.etiqueta_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.etiquetas e WHERE e.id = NEW.etiqueta_id AND e.tenant_id = v_loja) THEN
      RAISE EXCEPTION 'loja_diferente: etiqueta_id' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.cor_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.cores c WHERE c.id = NEW.cor_id AND c.tenant_id = v_loja) THEN
      RAISE EXCEPTION 'loja_diferente: cor_id' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_modelo_etiquetas() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_seg_pagina_modelo_observacoes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [seg s3c] (Reforco de seguranca S3c, P-231 = D2 A + B3) escrita DIRETA da tela/API em modelo_observacoes.
-- PAGINA: SECURITY INVOKER de proposito - so morde quem grava como o PAPEL do cliente (authenticated/anon = PostgREST); funcoes
-- do servidor (SECURITY DEFINER), CASCADE de FK, migrations/psql e service_role passam.
-- B3 (loja): vale para QUALQUER escrita (cliente e servidor) - INSERT, ou UPDATE que mude as colunas de vinculo -> P0001
-- 'loja_diferente: <coluna>'. Roda depois do set_tenant_id_trg (ordem alfabetica), entao tenant_id ja vem preenchido.
-- Observacoes (bloco ModeloObservacoes): ficha do Desenvolvimento (Sheet / Importar dados) OU o PCP Servicos (C-07).
DECLARE
  v_loja uuid;
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    PERFORM public._seg_exige_pagina('criacao_desenvolvimento', 'producao_terceirizados');
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT'
     OR NEW.modelo_id IS DISTINCT FROM OLD.modelo_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    SELECT m.tenant_id INTO v_loja FROM public.modelos m WHERE m.id = NEW.modelo_id;
    IF v_loja IS NULL OR (NEW.tenant_id IS NOT NULL AND NEW.tenant_id <> v_loja) THEN
      RAISE EXCEPTION 'loja_diferente: modelo_id' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

-- função de gatilho: ninguém a chama direto (EXECUTE só é conferido no CREATE TRIGGER; ANON-2 da S1)
REVOKE EXECUTE ON FUNCTION public.fn_seg_pagina_modelo_observacoes() FROM PUBLIC, anon, authenticated;

DO $trg$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.modelo_etiquetas'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.modelo_etiquetas
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_modelo_etiquetas();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.modelo_observacoes'::regclass AND t.tgname = 'trg_aaa_seg_pagina'
                  AND NOT t.tgisinternal) THEN
    CREATE TRIGGER trg_aaa_seg_pagina BEFORE INSERT OR UPDATE OR DELETE ON public.modelo_observacoes
      FOR EACH ROW EXECUTE FUNCTION public.fn_seg_pagina_modelo_observacoes();
  END IF;
END
$trg$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_seg_pagina_modelo_etiquetas()', '7e8cb620cd8c697d068bc712e5f2c0df', '2930cab11f9b2836e2005cf0229f9754', 'modelo_etiquetas', 31),
      ('public.fn_seg_pagina_modelo_observacoes()', '649719a1ac1b14f87fdf07bab66aa8f1', '63076d0418d076f0799a58cb48e78eb3', 'modelo_observacoes', 31)
    ) AS x(f, d, n, t, tt) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 's3c_guarda: pos-condicao falhou em %', r.f USING ERRCODE = 'P0001';
    END IF;
    -- tgtype 31 = ROW(1)+BEFORE(2)+INSERT(4)+DELETE(8)+UPDATE(16); sem colunas, sem WHEN; ligado ('O')
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.t) AND t.tgname = 'trg_aaa_seg_pagina'
                    AND t.tgfoid = to_regprocedure(r.f) AND t.tgtype = r.tt AND t.tgenabled = 'O'
                    AND t.tgqual IS NULL AND t.tgattr::text = '') THEN
      RAISE EXCEPTION 's3c_guarda: pos-condicao falhou no gatilho de %', r.t USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)) THEN
      RAISE EXCEPTION 's3c_guarda: pos-condicao falhou em % (EXECUTE ou SECURITY DEFINER)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
