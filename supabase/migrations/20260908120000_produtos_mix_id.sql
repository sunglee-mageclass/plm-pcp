-- Editar Família de Produtos p/ Acabado + Importado (INCLUINDO rascunhos) — #4b
-- ============================================================================
-- A "família" (colecao_mixes, agnóstica de origem) hoje só ancora em `modelos.mix_id`, então
-- um produto de revenda/importado EM RASCUNHO (sem card no Planejamento = sem espelho em
-- `modelos`) não pode ter família. Adiciona `mix_id` DIRETO nas tabelas de produto — cobre
-- rascunho E materializado. FK p/ colecao_mixes com ON DELETE SET NULL: excluir a família
-- limpa o vínculo sozinho (mesmo padrão de `modelos.mix_id`/`plan_tecido_slots.mix_id`), SEM
-- tocar a RPC `excluir_colecao_mix`. Aditiva/idempotente.

ALTER TABLE public.produtos_acabados
  ADD COLUMN IF NOT EXISTS mix_id uuid REFERENCES public.colecao_mixes(id) ON DELETE SET NULL;
ALTER TABLE public.produtos_importados
  ADD COLUMN IF NOT EXISTS mix_id uuid REFERENCES public.colecao_mixes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_produtos_acabados_mix   ON public.produtos_acabados(mix_id)   WHERE mix_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_importados_mix ON public.produtos_importados(mix_id) WHERE mix_id IS NOT NULL;
