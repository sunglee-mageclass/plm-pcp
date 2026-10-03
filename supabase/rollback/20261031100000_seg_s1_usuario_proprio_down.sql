-- Inverso de supabase/migrations/20261031100000_seg_s1_usuario_proprio.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção 03/out).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.prevent_users_self_role_change()
--     ANTES  1646cd991e542bde6298bca5884165d1
--     DEPOIS 67b3a01f0702d6515d00a8dc4472e2ba
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
      ('public.prevent_users_self_role_change()', '1646cd991e542bde6298bca5884165d1', '67b3a01f0702d6515d00a8dc4472e2ba')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 's1_n1_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.prevent_users_self_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() = OLD.id
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NOT (public.is_super_admin() OR public.is_tenant_admin())
  THEN
    RAISE EXCEPTION 'Não é permitido alterar o próprio role';
  END IF;

  IF auth.uid() = OLD.id
     AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     AND NOT public.is_super_admin()
  THEN
    RAISE EXCEPTION 'Não é permitido alterar o próprio tenant';
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
      ('public.prevent_users_self_role_change()', '1646cd991e542bde6298bca5884165d1')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's1_n1_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;
COMMIT;
