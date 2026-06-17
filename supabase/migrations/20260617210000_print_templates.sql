-- Templates de impressão personalizáveis por loja (ex.: cabeçalho da Ficha de Corte).
-- layout é um JSON com os blocos posicionados em grade.
CREATE TABLE IF NOT EXISTS public.print_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  doc_type VARCHAR(50) NOT NULL,
  layout JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, doc_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.print_templates TO authenticated;
GRANT ALL ON public.print_templates TO service_role;
ALTER TABLE public.print_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.print_templates
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_insert" ON public.print_templates
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_update" ON public.print_templates
  FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_delete" ON public.print_templates
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.print_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
