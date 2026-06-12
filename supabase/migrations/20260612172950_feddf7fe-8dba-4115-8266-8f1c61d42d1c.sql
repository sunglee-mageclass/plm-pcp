ALTER TABLE public.ocs_tecido
ADD COLUMN IF NOT EXISTS parcelas_recebimento jsonb NOT NULL DEFAULT '[]'::jsonb;