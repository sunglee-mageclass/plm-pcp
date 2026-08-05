-- Direcionamento multi-lojas — fix round 1 (review da Task 1), 2 achados IMPORTANT:
-- 1) RLS de escrita frouxa: INSERT/UPDATE/DELETE em lojas_direcionamento só checavam
--    tenant_id = get_user_tenant_id() — qualquer authenticated do tenant escrevia direto
--    via PostgREST. Alinha ao padrão do repo (ex.: categorias_terceirizado, tenant_config):
--    escrita exige tenant_id = get_user_tenant_id() AND is_tenant_admin(), OU is_super_admin().
--    SELECT não muda (leitura por tenant continua liberada a qualquer authenticated do tenant).
-- 2) Nada garantia 1 só default por tenant — RPCs futuras fazem `where is_default limit 1`
--    sem ORDER BY; 2 defaults no mesmo tenant = corrupção silenciosa (escolha não-determinística).
--    Índice único parcial fecha a lacuna.
BEGIN;

DROP POLICY IF EXISTS lojas_dir_ins ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_upd ON public.lojas_direcionamento;
DROP POLICY IF EXISTS lojas_dir_del ON public.lojas_direcionamento;

CREATE POLICY lojas_dir_ins ON public.lojas_direcionamento FOR INSERT
  WITH CHECK ((tenant_id = get_user_tenant_id() AND is_tenant_admin()) OR is_super_admin());
CREATE POLICY lojas_dir_upd ON public.lojas_direcionamento FOR UPDATE
  USING ((tenant_id = get_user_tenant_id() AND is_tenant_admin()) OR is_super_admin())
  WITH CHECK ((tenant_id = get_user_tenant_id() AND is_tenant_admin()) OR is_super_admin());
CREATE POLICY lojas_dir_del ON public.lojas_direcionamento FOR DELETE
  USING ((tenant_id = get_user_tenant_id() AND is_tenant_admin()) OR is_super_admin());

CREATE UNIQUE INDEX IF NOT EXISTS lojas_direcionamento_um_default
  ON public.lojas_direcionamento (tenant_id) WHERE is_default;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
