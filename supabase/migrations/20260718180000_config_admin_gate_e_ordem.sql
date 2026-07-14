-- Config da Loja escreve DIRETO (sem RPC) em categorias_terceirizado e tenant_config,
-- e a tela só gateava no CLIENTE (Navigate). A RLS dessas escritas checava só o tenant,
-- SEM o papel → um usuário comum podia gravar via API. Fecha o gate de admin no servidor.
-- set_tenant_id_trg (BEFORE INSERT) preenche tenant_id antes do WITH CHECK, então o
-- ramo "tenant_id IS NULL" era morto e é removido.
BEGIN;

-- 1) categorias_terceirizado: escrita só p/ tenant_admin (do próprio tenant) OU super_admin.
--    (esta tabela NÃO tinha policy de super_admin, por isso o OR is_super_admin() inline.)
DROP POLICY IF EXISTS tenant_insert ON public.categorias_terceirizado;
CREATE POLICY tenant_insert ON public.categorias_terceirizado FOR INSERT
  WITH CHECK (((tenant_id = get_user_tenant_id()) AND is_tenant_admin()) OR is_super_admin());

DROP POLICY IF EXISTS tenant_update ON public.categorias_terceirizado;
CREATE POLICY tenant_update ON public.categorias_terceirizado FOR UPDATE
  USING (((tenant_id = get_user_tenant_id()) AND is_tenant_admin()) OR is_super_admin())
  WITH CHECK (((tenant_id = get_user_tenant_id()) AND is_tenant_admin()) OR is_super_admin());

DROP POLICY IF EXISTS tenant_delete ON public.categorias_terceirizado;
CREATE POLICY tenant_delete ON public.categorias_terceirizado FOR DELETE
  USING (((tenant_id = get_user_tenant_id()) AND is_tenant_admin()) OR is_super_admin());
-- SELECT segue tenant-only (a lista é lida por não-admins em várias telas).

-- 2) tenant_config INSERT: exige tenant_admin. UPDATE/DELETE já exigiam; super é coberto
--    pela policy ALL super_admin_all_tenant_config (permissiva, OR'd).
DROP POLICY IF EXISTS tenant_insert ON public.tenant_config;
CREATE POLICY tenant_insert ON public.tenant_config FOR INSERT
  WITH CHECK ((tenant_id = get_user_tenant_id()) AND is_tenant_admin());

-- 3) Backfill: novas categorias entravam com ordem=0 (default) pois o insert não semeava
--    ordem → ordenação não-determinística. Renumera 0..n-1 por tenant, preservando a atual.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY ordem, id) - 1 AS rn
  FROM public.categorias_terceirizado
)
UPDATE public.categorias_terceirizado c SET ordem = r.rn
FROM ranked r WHERE c.id = r.id AND c.ordem <> r.rn;

COMMIT;
