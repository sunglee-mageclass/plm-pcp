-- Modelo sem serviço pós-costura (acabamento): faz o Status Geral dos Serviços virar
-- "Finalizado" mesmo sem serviço pós selecionado (peças que não precisam de acabamento).
ALTER TABLE public.cad
  ADD COLUMN IF NOT EXISTS sem_acabamento boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.cad.sem_acabamento IS
  'Modelo nao tem servico pos-costura (acabamento). Pre finalizado sem pos vira Finalizado.';
