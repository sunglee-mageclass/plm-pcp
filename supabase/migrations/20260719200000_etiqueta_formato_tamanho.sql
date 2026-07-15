-- Etiqueta: formato de exibição do tamanho. A grade guarda "34|PPP" (número|letra),
-- mas a etiqueta física traz só um. `formato_tamanho` controla o que MOSTRAR/imprimir:
--   'ambos'  → "PPP · 34" (como hoje)
--   'numero' → "34"
--   'letra'  → "PPP"
-- A variante continua guardando o tamanho completo da grade (mapeia a explosão por tamanho).

ALTER TABLE public.etiquetas
  ADD COLUMN IF NOT EXISTS formato_tamanho text NOT NULL DEFAULT 'ambos';

select pg_notify('pgrst','reload schema');
