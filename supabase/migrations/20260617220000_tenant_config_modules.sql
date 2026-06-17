-- Modularização: habilitar/desabilitar módulos por loja.
-- Flag por tenant em tenant_config.modules (jsonb). Default = todos os 6 módulos
-- ligados, para NÃO afetar lojas existentes. As chaves batem exatamente com
-- PAGES_CATALOG em src/lib/permissions-catalog.ts.
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT
    '{"cadastro":true,"entrada_saida":true,"criacao":true,"producao":true,"financeiro":true,"dashboard":true}'::jsonb;

-- Super_admin gerencia a config de QUALQUER loja: a edição da loja em
-- "Gerenciar Lojas" precisa escrever os módulos na tenant_config de outro tenant
-- (as policies tenant genéricas só permitem o próprio tenant). Espelha
-- a policy "super_admin_all_tenants".
DROP POLICY IF EXISTS "super_admin_all_tenant_config" ON public.tenant_config;
CREATE POLICY "super_admin_all_tenant_config" ON public.tenant_config
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
