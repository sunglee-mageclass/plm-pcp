-- Markup Mín/Ideal/Máx na Linha (Cadastro > Atributos > Linha) — FASE A (modelo de dados)
-- ============================================================================
-- Hoje `linhas.markup` (numeric, multiplicador ex. 2,50×) é o único markup — passa a ser o
-- IDEAL. Adiciona `markup_min` e `markup_max` (mesmo tipo/semântica: multiplicador, nullable).
-- Aditiva/idempotente. NÃO altera preco.ts nem a cadeia de custo (invariante #8) — o cálculo
-- da "M.O. necessária"/semáforo é Fase B. Aqui é só schema.
--
-- Sem default: linha sem faixas definidas = campos NULL (o Ideal segue sendo `markup`).
-- Ordem esperada quando preenchidos: markup_min <= markup <= markup_max (validado na UI).

ALTER TABLE public.linhas
  ADD COLUMN IF NOT EXISTS markup_min numeric,
  ADD COLUMN IF NOT EXISTS markup_max numeric;
