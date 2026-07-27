-- Motivo OBRIGATÓRIO ao reprovar o custo de mão de obra (card do Planejamento).
-- Limpo (null) ao aprovar. Coluna solta, sem RPC — gravado no mesmo UPDATE direto de
-- `custo_terceirizados_aprovado` (passa pelo trigger trg_enforce_maodeobra_aprovacao,
-- que só valida a mudança do flag, não as colunas extras).
BEGIN;

ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS motivo_reprovacao_mao_obra text;

COMMENT ON COLUMN public.modelos.motivo_reprovacao_mao_obra IS
  'Motivo da reprovação do custo de mão de obra (Planejamento); limpo ao aprovar.';

COMMIT;
