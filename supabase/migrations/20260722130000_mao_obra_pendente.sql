-- Mão de obra ganha um 3º estado: PENDENTE (null) além de aprovado(true)/reprovado(false).
-- Pendente = nenhuma seleção (ícones cinzas, bolinha amarela). O gate (kanban + lançar)
-- já usa coalesce(...,false), então pendente NÃO libera.
BEGIN;
ALTER TABLE public.modelos ALTER COLUMN custo_terceirizados_aprovado DROP DEFAULT;
ALTER TABLE public.modelos ALTER COLUMN custo_terceirizados_aprovado DROP NOT NULL;
-- feature nova: tudo que estava no default false vira pendente (null).
UPDATE public.modelos SET custo_terceirizados_aprovado = NULL WHERE custo_terceirizados_aprovado = false;
COMMIT;
