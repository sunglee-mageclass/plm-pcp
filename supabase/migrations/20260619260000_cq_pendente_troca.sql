-- Alertas de Tecido: status "pendente para troca". O "cancelamento" reaproveita
-- a coluna existente ocs_tecido_itens.cancelado (já exclui de estoque/consumo/
-- parcelas/prévia).
ALTER TABLE public.ocs_tecido_itens
  ADD COLUMN IF NOT EXISTS cq_pendente_troca boolean NOT NULL DEFAULT false;
