-- Em cada bloco de serviço (producao_terceirizados), além dos aviamentos, registrar
-- quais tecidos/forros/entretelas (modelo_tecidos) foram enviados.
ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS tecidos_enviados JSONB DEFAULT '[]';
