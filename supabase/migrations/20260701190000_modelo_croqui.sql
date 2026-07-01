-- Foto do Croqui no Planejamento (antes do Desenho Técnico). Anexo único (imagem ou PDF).
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS croqui_url text;
