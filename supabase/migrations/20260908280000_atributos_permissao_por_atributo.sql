-- Permissão de EDIÇÃO por atributo (destrincha `cadastro_atributos`). Cada atributo vira uma
-- sub-permissão `cadastro_atributos:<value>`; a RLS de escrita de cada tabela passa a exigir
-- `user_can_edit('cadastro_atributos:<value>')` (admins furam por dentro do helper). SELECT
-- (leitura) NÃO muda — quem vê a página lê os atributos. A key `<value>` casa com o `value` do
-- atributo em cadastro.atributos.tsx e a section do permissions-catalog.ts.
--
-- BACKFILL (à prova de lock-out): todo usuário que HOJE tem cadastro_atributos.pode_editar=true
-- ganha as 18 sections pode_editar=true, para NINGUÉM perder a edição no deploy. (Papéis: zero têm
-- hoje; incluído por robustez.) Admins não dependem disso (user_can_edit já os libera).
--
-- Grade de Tamanhos (`grade_tamanhos`) fica de FORA da RLS aqui (mora em tenant_config.tamanhos_grade,
-- update da linha da loja — já tenant/admin-scoped); só o gate de UI vale p/ ela nesta leva.

BEGIN;

-- ── 1) BACKFILL das sections a partir da permissão-mãe (ANTES de ligar a RLS) ──────────────────
-- user_permissions
INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT up.user_id, up.tenant_id, 'cadastro_atributos:' || attr, true, true
FROM public.user_permissions up
CROSS JOIN (VALUES
  ('cores'),('cores_apelido'),('anos'),('meses'),('cat_fornecedor'),('cat_tecido'),
  ('cat_aviamento'),('subcat_aviamento'),('mat_aviamento'),('intervalo_largura'),('tipo_insumo'),
  ('grupo_produto'),('cat_produto'),('subcat1_produto'),('subcat2_produto'),('linhas'),
  ('cat_terceirizado')
) AS a(attr)
WHERE up.pagina = 'cadastro_atributos' AND up.pode_editar = true
ON CONFLICT (user_id, pagina) DO NOTHING;

-- papel_permissoes (mesma lógica; UNIQUE (papel_id, pagina))
INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
SELECT pp.papel_id, pp.tenant_id, 'cadastro_atributos:' || attr, true, true
FROM public.papel_permissoes pp
CROSS JOIN (VALUES
  ('cores'),('cores_apelido'),('anos'),('meses'),('cat_fornecedor'),('cat_tecido'),
  ('cat_aviamento'),('subcat_aviamento'),('mat_aviamento'),('intervalo_largura'),('tipo_insumo'),
  ('grupo_produto'),('cat_produto'),('subcat1_produto'),('subcat2_produto'),('linhas'),
  ('cat_terceirizado')
) AS a(attr)
WHERE pp.pagina = 'cadastro_atributos' AND pp.pode_editar = true
ON CONFLICT (papel_id, pagina) DO NOTHING;

-- ── 2) RLS: recria tenant_insert/update/delete de cada tabela + AND user_can_edit(section) ──────
-- Loop sobre (tabela, section-key). Recria as 3 policies-padrão preservando o tenant-scope e o
-- comportamento original (INSERT aceita tenant_id NULL do trigger set_tenant_id), só ADICIONANDO
-- a checagem de permissão. As policies EXTRA (ex.: meses_no_insert/no_delete de super_admin) NÃO
-- são tocadas — seguem restringindo por cima.
DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('cores','cores'),
      ('cores_apelido','cores_apelido'),
      ('anos','anos'),
      ('meses','meses'),
      ('categorias_fornecedor','cat_fornecedor'),
      ('categorias_tecido','cat_tecido'),
      ('categorias_aviamento','cat_aviamento'),
      ('subcategorias_aviamento','subcat_aviamento'),
      ('materiais_aviamento','mat_aviamento'),
      ('intervalos_largura','intervalo_largura'),
      ('tipos_insumo','tipo_insumo'),
      ('grupos_produto','grupo_produto'),
      ('categorias_produto','cat_produto'),
      ('subcategorias1_produto','subcat1_produto'),
      ('subcategorias2_produto','subcat2_produto'),
      ('linhas','linhas'),
      ('categorias_terceirizado','cat_terceirizado')
    ) AS t(tbl, attr)
  LOOP
    -- INSERT
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT TO authenticated
         WITH CHECK (((tenant_id = get_user_tenant_id()) OR (tenant_id IS NULL))
                     AND public.user_can_edit(%L))',
      r.tbl, 'cadastro_atributos:' || r.attr);
    -- UPDATE
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE TO authenticated
         USING ((tenant_id = get_user_tenant_id()) AND public.user_can_edit(%L))
         WITH CHECK ((tenant_id = get_user_tenant_id()) AND public.user_can_edit(%L))',
      r.tbl, 'cadastro_atributos:' || r.attr, 'cadastro_atributos:' || r.attr);
    -- DELETE
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE TO authenticated
         USING ((tenant_id = get_user_tenant_id()) AND public.user_can_edit(%L))',
      r.tbl, 'cadastro_atributos:' || r.attr);
  END LOOP;
END $mig$;

COMMIT;

select pg_notify('pgrst','reload schema');
