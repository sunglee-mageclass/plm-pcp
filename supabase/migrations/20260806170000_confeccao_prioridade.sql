-- Prioridade da fonte de confecção (grade cortada): array ordenado de categoria_terceirizado_id.
-- Aditivo/idempotente. Sem valor = default no código (PL antes de Oficina/Costura).
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS confeccao_prioridade jsonb NOT NULL DEFAULT '[]'::jsonb;
