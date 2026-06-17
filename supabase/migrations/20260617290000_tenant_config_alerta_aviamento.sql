-- Alertas de estoque: separar tecido (sempre em metros; kg vira metros) e aviamento.
-- estoque_critico_threshold (já existe) = alerta de TECIDO em metros.
-- estoque_critico_aviamento (nova) = alerta de AVIAMENTO (na unidade do aviamento).
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS estoque_critico_aviamento numeric DEFAULT 0;
