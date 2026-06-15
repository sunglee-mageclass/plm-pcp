ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS versao integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS modelo_base_id uuid NULL REFERENCES public.modelos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_modelos_base ON public.modelos(modelo_base_id);