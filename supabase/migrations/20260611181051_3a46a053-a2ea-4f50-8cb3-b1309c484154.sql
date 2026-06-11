ALTER TABLE public.controle_qualidade
  ADD COLUMN IF NOT EXISTS data_recebimento_enviado_oficina date,
  ADD COLUMN IF NOT EXISTS data_recebimento_prevista date,
  ADD COLUMN IF NOT EXISTS data_recebimento_entregue date;