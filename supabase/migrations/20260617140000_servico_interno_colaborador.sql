-- Serviço Interno: o "Responsável" é um Colaborador (colaboradores.tipo='interno'),
-- e não um terceirizado. Coluna nova para guardar esse colaborador.
ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS colaborador_id UUID REFERENCES public.colaboradores(id);

-- Oficina passa a ser um card de serviço dentro de Produção > Serviços:
-- ganha o tipo Interno/PL e o colaborador, como os demais serviços.
ALTER TABLE public.producao_oficina
  ADD COLUMN IF NOT EXISTS interno BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.producao_oficina
  ADD COLUMN IF NOT EXISTS colaborador_id UUID REFERENCES public.colaboradores(id);
