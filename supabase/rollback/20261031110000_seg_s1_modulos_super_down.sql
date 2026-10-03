-- Inverso de supabase/migrations/20261031110000_seg_s1_modulos_super.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção 03/out).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_kanban_chave_protegida()
--     ANTES  1ef1c127ef0981132f66b4549914368b
--     DEPOIS b0d06cc77762643040c8aff07fba3f0b
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / REVOKE-GRANT EXECUTE / ALTER DEFAULT PRIVILEGES): nenhuma tabela de
-- negócio, nada de auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY. Idempotente (guarda aceita antes OU depois).
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
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_kanban_chave_protegida()', '1ef1c127ef0981132f66b4549914368b', 'b0d06cc77762643040c8aff07fba3f0b')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 's1_mod1_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_kanban_chave_protegida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.kanban_chave', true), '') = 'rpc' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.kanban_automatico := false;
  ELSE
    NEW.kanban_automatico := OLD.kanban_automatico;
  END IF;
  RETURN NEW;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_kanban_chave_protegida()', '1ef1c127ef0981132f66b4549914368b')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's1_mod1_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;
COMMIT;
