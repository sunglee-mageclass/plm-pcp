-- Config da loja: trabalhar com OC, Rolo ou ambos (afeta o vínculo de tecido no
-- Desenvolvimento — quais aparecem para selecionar). Default 'ambos' = sem mudança.
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS modo_oc_rolo text NOT NULL DEFAULT 'ambos';
