-- 20260721100000_otb_drop_sync.sql
-- Remove o sync bidirecional OTB↔cards e limpa os blanks legados (cards "vazios"
-- criados pelo antigo otb_confirmar). Depois disto o plano é ALVO FIXO.
BEGIN;

DROP TRIGGER IF EXISTS trg_otb_sync_semana ON public.modelos;
DROP FUNCTION IF EXISTS public.fn_otb_sync_semana() CASCADE;
DROP FUNCTION IF EXISTS public.fn_otb_dec_semana_on_delete() CASCADE;

-- Limpeza ÚNICA: apaga cards "sem conteúdo" vinculados a uma coleção (nome/estilista/
-- fotos/tecidos/preço/obs vazios, não lançado). Cobre os blanks legados dos dois fluxos
-- (Orçamento: têm categoria/subcol/semana; PV: têm linha/subcol/semana) — ambos sem conteúdo.
DELETE FROM public.modelos m
WHERE m.colecao_id IS NOT NULL
  AND m.status_planejamento IN ('em_planejamento','reprovado')
  AND COALESCE(m.nome,'') = '' AND m.estilista_id IS NULL
  AND m.preco_venda IS NULL AND m.data_lancamento IS NULL AND COALESCE(m.lancado,false) = false
  AND m.origem = 'interno' AND COALESCE(m.observacoes_gerais,'') = ''
  AND cardinality(COALESCE(m.fotos_modelo,'{}')) = 0
  AND cardinality(COALESCE(m.fotos_referencia,'{}')) = 0
  AND cardinality(COALESCE(m.tecidos_planejados,'{}')) = 0;

COMMIT;
