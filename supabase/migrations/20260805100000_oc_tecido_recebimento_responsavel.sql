-- OC Tecido — "Responsável pelo recebimento" (seção 4 · Recebimento).
-- Espelha o padrão do Responsável do pedido (responsavel_id/responsavel_nome):
-- id de colaborador (FK) + nome livre (modo "Livre" do ResponsavelSelect).
-- Campo OPCIONAL. Idempotente (IF NOT EXISTS) — pode reaplicar sem efeito.
ALTER TABLE public.ocs_tecido
  ADD COLUMN IF NOT EXISTS recebimento_responsavel_id uuid REFERENCES public.colaboradores(id),
  ADD COLUMN IF NOT EXISTS recebimento_responsavel_nome text;
