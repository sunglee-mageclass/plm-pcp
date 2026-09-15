-- FIX: presença/ring + realtime do Direcionamento quebraram após a Onda 1 do merge.
--
-- Causa: as policies da âncora `direcionamento_controle` (migração 20260915140000) não espelhavam o
-- molde do CQ (controle_qualidade), que FUNCIONA no Realtime:
--   (a) o SELECT estava para o role `public` em vez de `authenticated` — o Realtime lê as mudanças
--       COMO `authenticated` (apply_rls), então a policy tem que conceder a esse role;
--   (b) o modgate RESTRICTIVE era `FOR ALL` (inclui SELECT) → adicionava `tenant_module_enabled('producao')`
--       como condição do SELECT. O Realtime aplica RLS mas NÃO tem o contexto de tenant p/ avaliar
--       `tenant_module_enabled` → a leitura da âncora falhava → o canal `postgres_changes` nunca ficava
--       saudável → `ch.track()` (presença) e o broadcast (foco/ring) nunca disparavam. Resultado: nem
--       presença ("fulano está na página") nem ring apareciam.
--
-- Correção: espelhar EXATAMENTE o CQ — SELECT/INSERT/UPDATE PERMISSIVE p/ `authenticated` com
-- `tenant_id = get_user_tenant_id()`, e o modgate RESTRICTIVE SÓ em INSERT/UPDATE (NÃO em SELECT).
-- (A escrita real via RPC é SECURITY DEFINER e já valida o módulo; o gate de SELECT era desnecessário
-- e nocivo ao Realtime.)

BEGIN;

-- Remove as policies erradas.
DROP POLICY IF EXISTS dircontrole_sel ON public.direcionamento_controle;
DROP POLICY IF EXISTS dircontrole_ins ON public.direcionamento_controle;
DROP POLICY IF EXISTS dircontrole_upd ON public.direcionamento_controle;
DROP POLICY IF EXISTS modgate_dircontrole ON public.direcionamento_controle;

-- PERMISSIVE p/ authenticated (espelha tenant_select/insert/update do controle_qualidade).
CREATE POLICY dircontrole_sel ON public.direcionamento_controle FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY dircontrole_ins ON public.direcionamento_controle FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY dircontrole_upd ON public.direcionamento_controle FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Modgate RESTRICTIVE do módulo producao — SÓ em escrita (INSERT/UPDATE), NUNCA em SELECT
-- (espelha modgate_ins/modgate_upd do CQ; o Realtime lê o SELECT sem o gate).
CREATE POLICY modgate_dircontrole_ins ON public.direcionamento_controle AS RESTRICTIVE FOR INSERT
  WITH CHECK (public.tenant_module_enabled('producao'));
CREATE POLICY modgate_dircontrole_upd ON public.direcionamento_controle AS RESTRICTIVE FOR UPDATE
  USING (public.tenant_module_enabled('producao'))
  WITH CHECK (public.tenant_module_enabled('producao'));

COMMIT;
