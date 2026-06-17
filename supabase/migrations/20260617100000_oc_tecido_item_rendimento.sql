-- OC de Tecido: permite preencher o rendimento (m/kg) por OC, sobrescrevendo
-- o rendimento padrão do artigo (cadastro) nos cálculos de metragem.
-- Guardado por item; itens do mesmo tecido na OC compartilham o mesmo valor.
ALTER TABLE public.ocs_tecido_itens
  ADD COLUMN IF NOT EXISTS rendimento numeric;
