-- 20260821120000_pcp_etapas_pl_fase1.sql
-- Fase 1 das Etapas PL: campos de Peça Teste no bloco + config das etapas. NÃO destrutiva.
BEGIN;

ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS pt_data_saida   date,
  ADD COLUMN IF NOT EXISTS pt_data_entrada date,
  ADD COLUMN IF NOT EXISTS pt_aprovacao    text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'producao_terceirizados_pt_aprovacao_chk') THEN
    ALTER TABLE public.producao_terceirizados
      ADD CONSTRAINT producao_terceirizados_pt_aprovacao_chk
      CHECK (pt_aprovacao IS NULL OR pt_aprovacao IN ('aprovado','reprovado'));
  END IF;
END $$;

-- config das 5 etapas (ordem/gatilho fixos; label renomeável; ativa liga/desliga).
-- default aplicado em tempo de LEITURA no front; aqui só garantimos a coluna.
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS pcp_etapas jsonb;

COMMIT;
