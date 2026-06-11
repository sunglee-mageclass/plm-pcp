ALTER TABLE public.ocs_tecido
  ADD COLUMN IF NOT EXISTS etiqueta_lavagem_url_1 text,
  ADD COLUMN IF NOT EXISTS etiqueta_lavagem_url_2 text;