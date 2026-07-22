-- Aprovação (por modelo) do custo de mão de obra / serviços previstos.
-- 2 estados: true=aprovado, false=reprovado (default). Substitui a aprovação
-- por-bloco (producao_terceirizados.aprovado), que passa a ser órfã.
ALTER TABLE public.modelos
  ADD COLUMN IF NOT EXISTS custo_terceirizados_aprovado boolean NOT NULL DEFAULT false;
