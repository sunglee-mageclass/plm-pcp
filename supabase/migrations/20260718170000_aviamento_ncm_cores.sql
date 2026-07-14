-- Aviamentos ganham NCM (código fiscal digitável) + cor base (cores) + cor apelido
-- (cores_apelido, que já liga à base via cor_base_id). Espelha o par cor base/apelido
-- das variantes de tecido. Aditiva: colunas nullable, nada a migrar nas linhas existentes.
-- ON DELETE SET NULL: apagar uma cor não bloqueia nem perde o aviamento, só limpa a ref.
BEGIN;

ALTER TABLE public.aviamentos
  ADD COLUMN IF NOT EXISTS ncm text,
  ADD COLUMN IF NOT EXISTS cor_id uuid REFERENCES public.cores(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cor_apelido_id uuid REFERENCES public.cores_apelido(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_aviamentos_cor ON public.aviamentos(cor_id);
CREATE INDEX IF NOT EXISTS idx_aviamentos_cor_apelido ON public.aviamentos(cor_apelido_id);

COMMIT;
