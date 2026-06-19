-- Histórico de NF da OC de tecido (troca traz NF nova; guarda as anteriores).
ALTER TABLE public.ocs_tecido
  ADD COLUMN IF NOT EXISTS nf_historico jsonb NOT NULL DEFAULT '[]'::jsonb;
