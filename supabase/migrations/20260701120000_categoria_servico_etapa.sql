-- Fase 1 da reestruturação pré/pós costura: cada CATEGORIA de serviço passa a ter uma
-- etapa (ate_costura = "pré" / pos_costura = "pós" = o antigo "acabamento"). Default: pré.
ALTER TABLE public.categorias_terceirizado
  ADD COLUMN IF NOT EXISTS etapa text NOT NULL DEFAULT 'ate_costura';

DO $$ BEGIN
  ALTER TABLE public.categorias_terceirizado
    ADD CONSTRAINT categorias_terceirizado_etapa_chk CHECK (etapa IN ('ate_costura','pos_costura'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
