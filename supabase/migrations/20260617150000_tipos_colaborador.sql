-- Tipos de colaborador definidos pela loja (além dos fixos estilista/modelista/
-- piloteiro). Cada tipo agrupa colaboradores (colaboradores.tipo = tipos_colaborador.nome).
CREATE TABLE IF NOT EXISTS public.tipos_colaborador (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  nome VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tipos_colaborador TO authenticated;
GRANT ALL ON public.tipos_colaborador TO service_role;
ALTER TABLE public.tipos_colaborador ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.tipos_colaborador
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_insert" ON public.tipos_colaborador
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_update" ON public.tipos_colaborador
  FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant_delete" ON public.tipos_colaborador
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.tipos_colaborador
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
