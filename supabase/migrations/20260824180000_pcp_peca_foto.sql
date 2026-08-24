BEGIN;
ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS peca_foto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS peca_foto_data date;
COMMIT;
