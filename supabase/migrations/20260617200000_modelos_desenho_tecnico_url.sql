-- Anexo do Desenho Técnico do modelo (imagem ou PDF no bucket "modelos"),
-- editável no Planejamento e no Desenvolvimento.
ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS desenho_tecnico_url TEXT;
