-- TAG/Etiqueta pode ser atrelada a um tamanho da grade (ex.: "38|P") para calcular
-- a Qtd Planejada = consumo * (soma da grade desse tamanho).
ALTER TABLE public.etiquetas
  ADD COLUMN IF NOT EXISTS tamanho VARCHAR(50);

-- Etiquetas usadas em cada CAD (abaixo da Explosão de Aviamentos).
CREATE TABLE IF NOT EXISTS public.cad_etiquetas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cad_id UUID REFERENCES public.cad(id) ON DELETE CASCADE,
  etiqueta_id UUID REFERENCES public.etiquetas(id),
  consumo NUMERIC(10,4),
  quantidade_planejada NUMERIC(10,2),
  quantidade_enviar NUMERIC(10,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cad_etiquetas TO authenticated;
GRANT ALL ON public.cad_etiquetas TO service_role;
ALTER TABLE public.cad_etiquetas ENABLE ROW LEVEL SECURITY;

-- Acesso mediado pelo CAD pai (mesmo padrão de cad_aviamentos).
CREATE POLICY "child_all_cad_etiquetas" ON public.cad_etiquetas FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cad p WHERE p.id = cad_id AND p.tenant_id = public.get_user_tenant_id()));
