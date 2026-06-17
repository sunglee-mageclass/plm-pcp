-- Cadastro de TAG/Etiquetas (lista simples por loja).
CREATE TABLE IF NOT EXISTS public.etiquetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.etiquetas TO authenticated;
GRANT ALL ON public.etiquetas TO service_role;
ALTER TABLE public.etiquetas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.etiquetas
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_insert" ON public.etiquetas
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_update" ON public.etiquetas
  FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_delete" ON public.etiquetas
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.etiquetas
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
