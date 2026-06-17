-- Modo de baixa de estoque de tecido no corte (Configurações da Loja).
-- 'por_oc'      = comportamento atual: vínculo modelo↔OC primeiro, FIFO no resto.
-- 'automatico'  = FIFO puro (consome sempre o estoque mais velho, ignora vínculo manual).
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS modo_baixa_estoque varchar(20) NOT NULL DEFAULT 'por_oc';

DO $$ BEGIN
  ALTER TABLE public.tenant_config
    ADD CONSTRAINT tenant_config_modo_baixa_chk
    CHECK (modo_baixa_estoque IN ('por_oc', 'automatico'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
