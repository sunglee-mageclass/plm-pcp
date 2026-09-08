-- M.O. sugerida por serviço + faixa-alvo de custo na Linha (estudo set/2026).
-- Duas colunas aditivas, nullable, POR PEÇA — só schema, nenhum cálculo do servidor lê isto:
--   (1) categorias_terceirizado.valor_padrao — valor sugerido de M.O. por peça de cada SERVIÇO.
--       A sugestão é 100% front (pré-preenche o campo do MaoObraEditor em linha NOVA); o valor
--       real gravado segue sendo modelo_servico_mo.valor. NULL = sem sugestão.
--   (2) linhas.custo_min/custo_ideal/custo_max — faixa-ALVO de custo por peça (espelha markup_*).
--       O custo real segue vindo do BOM/RPC (INTOCADO, inv #8); estas colunas só alimentam um
--       SEMÁFORO consultivo no card (caro/barato vs. meta). NULL = sem faixa (sem semáforo).
-- Não toca preco.ts, custo_unitario_modelos nem a aprovação de M.O. (inv #8/#12).

BEGIN;

ALTER TABLE public.categorias_terceirizado
  ADD COLUMN IF NOT EXISTS valor_padrao numeric;

ALTER TABLE public.linhas
  ADD COLUMN IF NOT EXISTS custo_min numeric,
  ADD COLUMN IF NOT EXISTS custo_ideal numeric,
  ADD COLUMN IF NOT EXISTS custo_max numeric;

COMMIT;

select pg_notify('pgrst','reload schema');
