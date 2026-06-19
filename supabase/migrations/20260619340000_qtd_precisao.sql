-- + precisão em quantidade_pedida/recebida: a conversão metragem÷rendimento (kg)
-- perdia casas (numeric(10,2)) e fazia 14m virar 13,99 ao ler de volta.
ALTER TABLE public.ocs_tecido_itens
  ALTER COLUMN quantidade_pedida TYPE numeric(14,4),
  ALTER COLUMN quantidade_recebida TYPE numeric(14,4);
