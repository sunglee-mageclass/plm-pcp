
-- Junction: terceirizados ↔ categorias_terceirizado (many-to-many)
CREATE TABLE public.terceirizado_categorias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  terceirizado_id uuid NOT NULL REFERENCES public.terceirizados(id) ON DELETE CASCADE,
  categoria_terceirizado_id uuid NOT NULL REFERENCES public.categorias_terceirizado(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terceirizado_id, categoria_terceirizado_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.terceirizado_categorias TO authenticated;
GRANT ALL ON public.terceirizado_categorias TO service_role;

ALTER TABLE public.terceirizado_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant select" ON public.terceirizado_categorias
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert" ON public.terceirizado_categorias
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL);
CREATE POLICY "tenant update" ON public.terceirizado_categorias
  FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant delete" ON public.terceirizado_categorias
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

-- Auto-set tenant_id from parent terceirizado
CREATE OR REPLACE FUNCTION public.set_terc_cat_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.terceirizados WHERE id = NEW.terceirizado_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_terc_cat_tenant
  BEFORE INSERT ON public.terceirizado_categorias
  FOR EACH ROW EXECUTE FUNCTION public.set_terc_cat_tenant();

CREATE INDEX idx_terc_cat_terc ON public.terceirizado_categorias(terceirizado_id);
CREATE INDEX idx_terc_cat_cat ON public.terceirizado_categorias(categoria_terceirizado_id);
CREATE INDEX idx_terc_cat_tenant ON public.terceirizado_categorias(tenant_id);

-- Backfill from existing single category
INSERT INTO public.terceirizado_categorias (tenant_id, terceirizado_id, categoria_terceirizado_id)
SELECT tenant_id, id, categoria_terceirizado_id
FROM public.terceirizados
WHERE categoria_terceirizado_id IS NOT NULL
ON CONFLICT DO NOTHING;
