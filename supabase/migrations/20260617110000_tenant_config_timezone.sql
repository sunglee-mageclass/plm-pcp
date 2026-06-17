-- Configuração da Loja: fuso horário (GMT) por tenant.
-- Influencia o relógio do topo e os cálculos de data/hora (mensagens de
-- prazo/atraso/adiantado das OCs). Default: Brasília/São Paulo (GMT-3).
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Sao_Paulo';
