-- Campo de observação livre sobre mão de obra do modelo.
-- Editável no Planejamento (Secão própria entre "Simulação de custo" e "Anexos")
-- e no Desenvolvimento (seção "8. Custos"). Coluna solta, sem RPC — o front grava
-- pelo UPDATE/INSERT direto em `modelos` que já existe nesses dois fluxos.
BEGIN;

ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS observacoes_mao_obra text;

COMMENT ON COLUMN public.modelos.observacoes_mao_obra IS
  'Observação livre sobre mão de obra do modelo (Planejamento e Desenvolvimento > Custos).';

COMMIT;
