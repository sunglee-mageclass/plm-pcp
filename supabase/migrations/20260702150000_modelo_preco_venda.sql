-- Preço para venda (editável no Planejamento). Custo/markup/preço/preço sugerido
-- e markup real são derivados (calculados na hora); só o preço de venda é salvo.
alter table public.modelos
  add column if not exists preco_venda numeric;
