-- Drift fix: a coluna artigos.etiqueta_lavagem_urls existia no Lovable Cloud
-- mas não tinha migration no repo, então faltava no Supabase próprio.
-- IF NOT EXISTS torna seguro aplicar em qualquer ambiente.
ALTER TABLE public.artigos
  ADD COLUMN IF NOT EXISTS etiqueta_lavagem_urls text[] NOT NULL DEFAULT '{}'::text[];
