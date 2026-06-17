-- Observações repetíveis por modelo (descrição | observação), editáveis no
-- Desenvolvimento e em Serviços. A 1ª linha (Composição) é derivada dos tecidos
-- em tempo de exibição (não fica gravada aqui).
CREATE TABLE IF NOT EXISTS public.modelo_observacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  modelo_id UUID NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  ordem INTEGER DEFAULT 0,
  descricao TEXT,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_modelo_observacoes_modelo ON public.modelo_observacoes(modelo_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.modelo_observacoes TO authenticated;
GRANT ALL ON public.modelo_observacoes TO service_role;
ALTER TABLE public.modelo_observacoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_select" ON public.modelo_observacoes;
CREATE POLICY "tenant_select" ON public.modelo_observacoes FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "tenant_insert" ON public.modelo_observacoes;
CREATE POLICY "tenant_insert" ON public.modelo_observacoes FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL);
DROP POLICY IF EXISTS "tenant_update" ON public.modelo_observacoes;
CREATE POLICY "tenant_update" ON public.modelo_observacoes FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id()) WITH CHECK (tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "tenant_delete" ON public.modelo_observacoes;
CREATE POLICY "tenant_delete" ON public.modelo_observacoes FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.modelo_observacoes;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.modelo_observacoes FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

NOTIFY pgrst, 'reload schema';
