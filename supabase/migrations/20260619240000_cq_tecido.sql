-- Fase 3 — CQ de Tecido. Controle de qualidade por item de OC de tecido (no
-- recebimento): observação, CQ ok, alertar estilo, estilo ok.
ALTER TABLE public.ocs_tecido_itens
  ADD COLUMN IF NOT EXISTS cq_observacao text,
  ADD COLUMN IF NOT EXISTS cq_ok boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cq_alertar_estilo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cq_estilo_ok boolean NOT NULL DEFAULT false;
