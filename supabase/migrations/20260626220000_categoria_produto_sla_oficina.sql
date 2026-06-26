-- SLA medio de oficina (em dias) por categoria de produto. Serve de benchmark no
-- dashboard de Producao (SLA por servico) p/ medir se a oficina esta num tempo bom/ruim.
-- So faz sentido fora do modo controle-de-estoque (a UI esconde no isStockOnly).
ALTER TABLE public.categorias_produto
  ADD COLUMN IF NOT EXISTS sla_oficina numeric;
