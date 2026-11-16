-- F7 · Armario (planejamento de vitrine do e-commerce) - Task A1, BANCO: as 2 TABELAS `armarios` + `armario_itens`.
-- Plano: docs/superpowers/plans/2026-11-16-f7-armario.md (Task A1). Molde de tabela/RLS/tenant/trigger: 20260708270000_mix_padroes.sql.
--
--   armarios       - 1 por (colecao, subcolecao, nome): grade de `colunas` (1..12, so VISUAL) com status rascunho -> pronto -> publicado.
--   armario_itens  - as variantes (produto x cor) do armario, em `ordem` (1..N). Estado completo regravado pela RPC (tasks seguintes).
--
-- DECISAO DE FK (cor/variante): `variante_tecido_id`, `produto_variante_id`, `cor_id` e `cor_apelido_id` sao uuid SEM FK (snapshot
-- puro). Motivos: (1) `produto_variante_id` aponta p/ 2 tabelas distintas (produto_acabado_variantes OU produto_importado_variantes,
-- conforme `origem`) - nao existe FK unica; (2) uma FK NO ACTION em cor/variante BLOQUEARIA o cadastro (excluir cor, podar variante do
-- produto = erro 23503 por causa de uma vitrine) e uma FK CASCADE/SET NULL apagaria/mutilaria a vitrine; o objetivo e "cor removida
-- NUNCA apaga nem trava nada". O ponteiro orfao e detectado na LEITURA (RPC armario_variantes_disponiveis, Task C1) e vira item
-- "cor removida". So `armario_id` (CASCADE: apagar o armario apaga os itens) e `modelo_id` (CASCADE: excluir o produto tira da vitrine)
-- e `colecao_id` (NO ACTION) sao FK reais.
--
-- DE-DUP: index UNICO (armario_id, modelo_id, variante_tecido_id, produto_variante_id) NULLS NOT DISTINCT (PG15+; o banco e PG17) -
-- a MESMA variante 2x no mesmo armario e recusada (23505); NULL conta como valor (item "em desenvolvimento", sem ponteiro, e unico por modelo).
-- Em armarios DIFERENTES a mesma variante pode repetir (o aviso "ja em outro armario" e da RPC de leitura, nao do banco).
--
-- ACL (pos-S5): authenticated com SELECT/INSERT/UPDATE/DELETE sob RLS (a escrita real vem pelas RPCs das proximas tasks); anon NADA;
-- service_role tudo. Explicito (REVOKE + GRANT) para nao depender do default ACL do ambiente. Gatilho de trava "publicado" = Task A2.
--
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE TRIGGER). So tabelas NOVAS: nao toca objeto existente.
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261202100000_armario_tabelas.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Volta: supabase/rollback/20261202100000_armario_tabelas_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.armarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,
  colecao_id  uuid REFERENCES public.colecoes(id),
  colecao     text,
  subcolecao  text NOT NULL,
  nome        varchar NOT NULL,
  colunas     int NOT NULL DEFAULT 5,
  status      text NOT NULL DEFAULT 'rascunho',
  ordem       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT armarios_status_ck  CHECK (status IN ('rascunho', 'pronto', 'publicado')),
  CONSTRAINT armarios_colunas_ck CHECK (colunas BETWEEN 1 AND 12)
);

CREATE TABLE IF NOT EXISTS public.armario_itens (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid,
  armario_id          uuid NOT NULL REFERENCES public.armarios(id) ON DELETE CASCADE,
  modelo_id           uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  origem              text NOT NULL,
  variante_tecido_id  uuid,   -- SEM FK (snapshot puro; ver DECISAO DE FK)
  produto_variante_id uuid,   -- SEM FK (2 tabelas possiveis; ver DECISAO DE FK)
  cor_id              uuid,   -- SEM FK
  cor_apelido_id      uuid,   -- SEM FK
  ordem               int NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_armarios_tenant_colecao_sub_ordem ON public.armarios (tenant_id, colecao_id, subcolecao, ordem);
CREATE INDEX IF NOT EXISTS idx_armario_itens_armario_ordem       ON public.armario_itens (armario_id, ordem);
CREATE INDEX IF NOT EXISTS idx_armario_itens_tenant_var_tecido   ON public.armario_itens (tenant_id, variante_tecido_id);
CREATE INDEX IF NOT EXISTS idx_armario_itens_tenant_prod_var     ON public.armario_itens (tenant_id, produto_variante_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_armario_itens_variante
  ON public.armario_itens (armario_id, modelo_id, variante_tecido_id, produto_variante_id) NULLS NOT DISTINCT;

-- tenant_id automatico + ACL + RLS por tenant (padrao do projeto; policies = molde mix_padroes).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['armarios', 'armario_itens'] LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id()', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL)', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_update ON public.%I FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id())', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', t);
    EXECUTE format('CREATE POLICY tenant_delete ON public.%I FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id())', t);
  END LOOP;
END $$;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
