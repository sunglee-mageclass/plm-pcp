
CREATE TABLE public.artigo_categorias_tecido (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  artigo_id uuid NOT NULL REFERENCES public.artigos(id) ON DELETE CASCADE,
  categoria_tecido_id uuid NOT NULL REFERENCES public.categorias_tecido(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artigo_id, categoria_tecido_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.artigo_categorias_tecido TO authenticated;
GRANT ALL ON public.artigo_categorias_tecido TO service_role;

ALTER TABLE public.artigo_categorias_tecido ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant select" ON public.artigo_categorias_tecido
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert" ON public.artigo_categorias_tecido
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL);
CREATE POLICY "tenant update" ON public.artigo_categorias_tecido
  FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant delete" ON public.artigo_categorias_tecido
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

CREATE OR REPLACE FUNCTION public.set_artigo_cat_tec_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT tenant_id INTO NEW.tenant_id FROM public.artigos WHERE id = NEW.artigo_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_artigo_cat_tec_tenant
  BEFORE INSERT ON public.artigo_categorias_tecido
  FOR EACH ROW EXECUTE FUNCTION public.set_artigo_cat_tec_tenant();

CREATE INDEX idx_artcat_tec_art ON public.artigo_categorias_tecido(artigo_id);
CREATE INDEX idx_artcat_tec_cat ON public.artigo_categorias_tecido(categoria_tecido_id);
CREATE INDEX idx_artcat_tec_tenant ON public.artigo_categorias_tecido(tenant_id);

INSERT INTO public.artigo_categorias_tecido (tenant_id, artigo_id, categoria_tecido_id)
SELECT tenant_id, id, categoria_tecido_id
FROM public.artigos
WHERE categoria_tecido_id IS NOT NULL
ON CONFLICT DO NOTHING;
