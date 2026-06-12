
-- Junction table for empresa <-> categoria_fornecedor (many-to-many)
CREATE TABLE IF NOT EXISTS public.empresa_categorias_fornecedor (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  categoria_fornecedor_id uuid NOT NULL REFERENCES public.categorias_fornecedor(id) ON DELETE CASCADE,
  tenant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, categoria_fornecedor_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.empresa_categorias_fornecedor TO authenticated;
GRANT ALL ON public.empresa_categorias_fornecedor TO service_role;

ALTER TABLE public.empresa_categorias_fornecedor ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_emp_cat_forn" ON public.empresa_categorias_fornecedor
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = empresa_id AND e.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "tenant_insert_emp_cat_forn" ON public.empresa_categorias_fornecedor
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = empresa_id AND e.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "tenant_update_emp_cat_forn" ON public.empresa_categorias_fornecedor
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = empresa_id AND e.tenant_id = public.get_user_tenant_id()));

CREATE POLICY "tenant_delete_emp_cat_forn" ON public.empresa_categorias_fornecedor
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.empresas e WHERE e.id = empresa_id AND e.tenant_id = public.get_user_tenant_id()));

-- Trigger to set tenant_id automatically from empresa
CREATE OR REPLACE FUNCTION public.set_emp_cat_forn_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.empresas WHERE id = NEW.empresa_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_emp_cat_forn_tenant ON public.empresa_categorias_fornecedor;
CREATE TRIGGER trg_set_emp_cat_forn_tenant
  BEFORE INSERT ON public.empresa_categorias_fornecedor
  FOR EACH ROW EXECUTE FUNCTION public.set_emp_cat_forn_tenant();

-- Backfill from existing single-column relationship
INSERT INTO public.empresa_categorias_fornecedor (empresa_id, categoria_fornecedor_id, tenant_id)
SELECT id, categoria_fornecedor_id, tenant_id
FROM public.empresas
WHERE categoria_fornecedor_id IS NOT NULL
ON CONFLICT DO NOTHING;
