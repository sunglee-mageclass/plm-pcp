-- Fornecedor no cadastro de Tecido/Aviamento passa a poder ser "empresa direto" OU
-- "empresa via representante" (como já é nas OCs). Guarda o representante escolhido.
-- Aditivo: coluna nullable + FK p/ representantes (mesma tabela que as OCs referenciam).
-- ON DELETE SET NULL: apagar um representante não bloqueia nem apaga o cadastro — só
-- limpa a referência (o vínculo com a empresa continua em empresa_id).

ALTER TABLE public.artigos
  ADD COLUMN IF NOT EXISTS representante_id uuid REFERENCES public.representantes(id) ON DELETE SET NULL;

ALTER TABLE public.aviamentos
  ADD COLUMN IF NOT EXISTS representante_id uuid REFERENCES public.representantes(id) ON DELETE SET NULL;
