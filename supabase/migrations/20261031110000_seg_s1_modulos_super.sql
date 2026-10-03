-- Reforço de segurança — Release S1 ("Fechar portas sem travar nada"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- MOD-1 (P-233 = D4 A): o admin da loja ligava/desligava modulos (tenant_config.modules) pela API (policy tenant_update).
-- Agora fn_kanban_chave_protegida (BEFORE INSERT/UPDATE, ja existente) devolve o valor de antes quando quem grava tem JWT e
-- nao e super admin (ignorado, sem erro); INSERT nasce com o padrao da coluna. Sem JWT (migration) e service_role passam.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_kanban_chave_protegida()
--     ANTES  1ef1c127ef0981132f66b4549914368b
--     DEPOIS b0d06cc77762643040c8aff07fba3f0b
-- ====================================================================================
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / REVOKE-GRANT EXECUTE / ALTER DEFAULT PRIVILEGES): nenhuma tabela de
-- negócio, nada de auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY. Idempotente (guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261031110000_seg_s1_modulos_super_down.sql (LIFO: os inversos da S1 rodam do mais novo ao mais antigo, ANTES dos inversos de releases
-- anteriores que guardam por md5 as mesmas funções — ver o relatório s1-report.md, seção "Cadeia md5").
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
      RAISE EXCEPTION 's1_mod1: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'public.tenant_config'::regclass AND a.attname = 'modules')
     IS DISTINCT FROM '''{"criacao": true, "cadastro": true, "producao": true, "dashboard": true, "financeiro": true, "entrada_saida": true}''::jsonb' THEN
    RAISE EXCEPTION 's1_mod1: DEFAULT de tenant_config.modules mudou (o INSERT de quem nao e super admin usa este literal)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_kanban_chave_protegida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [seg s1 MOD-1] (P-233 = D4 A) modulo e contratacao: SO o super admin liga/desliga (tenant_config.modules). Quem chega
  -- com JWT (PostgREST/RPC) sem ser super admin: no UPDATE a coluna volta ao valor de antes (ignorado, sem erro - o resto da
  -- linha grava); no INSERT nasce com o padrao da coluna (sem os opt-in). Sem JWT (migration/psql) e service_role passam.
  -- Fica ANTES do atalho da GUC app.kanban_chave (a RPC do kanban tambem nao muda modulo).
  IF (auth.uid() IS NOT NULL OR coalesce(auth.role(), '') IN ('authenticated', 'anon'))
     AND NOT public.is_super_admin() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.modules := '{"criacao": true, "cadastro": true, "producao": true, "dashboard": true, "financeiro": true, "entrada_saida": true}'::jsonb;
    ELSIF NEW.modules IS DISTINCT FROM OLD.modules THEN
      NEW.modules := OLD.modules;
    END IF;
  END IF;
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
      ('public.fn_kanban_chave_protegida()', 'b0d06cc77762643040c8aff07fba3f0b')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 's1_mod1: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;
COMMIT;
