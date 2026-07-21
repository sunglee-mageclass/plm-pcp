-- Simulação de custo no card do Planejamento (design 2026-07-21).
-- Guarda os valores previstos que o usuário digita na seção "Simulação de custo" do
-- detalhe do card. É um "e se?" manual, isolado do custo/preço real (BOM/CAD): NADA no
-- cálculo de preço real lê esta coluna. Estrutura (jsonb, tudo opcional):
--   { consumo_tecido: number(m), preco_tecido_m: number(R$/m), aviamento: number(R$), mao_obra: number(R$) }
-- Aditiva: só adiciona a coluna. RLS de modelos já isola por tenant; salva pelo UPDATE
-- INVOKER que o detalhe do Planejamento já faz. Sem RPC nova.
BEGIN;

ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS custo_simulado jsonb;

COMMENT ON COLUMN public.modelos.custo_simulado IS
  'Simulação de custo do Planejamento (manual, isolada do real): {consumo_tecido, preco_tecido_m, aviamento, mao_obra}.';

COMMIT;
