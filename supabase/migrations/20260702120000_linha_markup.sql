-- Markup por Linha (numérico, pode ser decimal) — usado em cálculos de preço.
-- Aditivo: coluna nullable, não quebra o front já no ar.
alter table public.linhas
  add column if not exists markup numeric;
