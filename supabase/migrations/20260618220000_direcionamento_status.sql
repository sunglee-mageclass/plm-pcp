-- Status de Direcionamento por CAD (espelha o padrão do Controle de Qualidade).
-- 'pendente' (default ao iniciar) -> 'separado' (verde) ao Confirmar. Trava as
-- edições do Direcionamento; "Editar" reabre e Salvar volta a travar.
ALTER TABLE public.cad
  ADD COLUMN IF NOT EXISTS direcionamento_status text NOT NULL DEFAULT 'pendente';
ALTER TABLE public.cad
  ADD COLUMN IF NOT EXISTS direcionamento_confirmado_at timestamptz;
