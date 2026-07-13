-- Leadtime — coluna de config (quais etapas + tempo ideal). A UI de edição (em
-- Configurações da Loja) vem na Fase 2; a coluna é lida pela RPC dashboard_leadtime.
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS leadtime jsonb;
