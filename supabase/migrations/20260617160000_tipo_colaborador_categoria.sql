-- Cada tipo de colaborador pode ser vinculado a uma categoria de terceirizado.
-- Assim, em Produção > Serviços, um serviço Interno de uma categoria (ex.: Corte)
-- lista apenas colaboradores de tipos ligados a essa categoria.
ALTER TABLE public.tipos_colaborador
  ADD COLUMN IF NOT EXISTS categoria_terceirizado_id UUID REFERENCES public.categorias_terceirizado(id);
