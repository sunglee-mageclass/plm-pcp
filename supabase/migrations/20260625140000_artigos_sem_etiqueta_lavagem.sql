-- Persiste o flag "este tecido NÃO tem etiqueta de lavagem" no próprio artigo (a
-- etiqueta é propriedade do tecido). Antes o checkbox no recebimento era só estado
-- de sessão e se perdia ao reabrir. Dispensa a etiqueta obrigatória no recebimento.
ALTER TABLE public.artigos
  ADD COLUMN IF NOT EXISTS sem_etiqueta_lavagem boolean NOT NULL DEFAULT false;
