-- Fase 3 — CQ Pós (controle de qualidade do acabamento / pós-costura).
-- Decisões do dono: NÃO recalcula grade real (só EXIBE a do Pré); registra
-- recebimento/conserto/defeito POR serviço de acabamento; confirma independente do Pré;
-- Direcionamento exige Pré E Pós confirmados (quando há pós).

-- 1) Status independente do CQ Pós (o `status` existente vira o do Pré).
ALTER TABLE public.controle_qualidade
  ADD COLUMN IF NOT EXISTS status_pos text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS confirmado_pos_at timestamptz,
  ADD COLUMN IF NOT EXISTS observacoes_cq_pos text,
  ADD COLUMN IF NOT EXISTS fotografado_variantes_pos jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN
  ALTER TABLE public.controle_qualidade
    ADD CONSTRAINT controle_qualidade_status_pos_chk CHECK (status_pos IN ('pendente','confirmado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) recebimento/conserto/defeito POR serviço de acabamento × variante × etapa.
CREATE TABLE IF NOT EXISTS public.cq_pos_variantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  controle_qualidade_id uuid NOT NULL REFERENCES public.controle_qualidade(id) ON DELETE CASCADE,
  producao_terceirizado_id uuid NOT NULL REFERENCES public.producao_terceirizados(id) ON DELETE CASCADE,
  variante_numero integer NOT NULL,
  etapa varchar(20) NOT NULL,          -- 'recebimento' | 'conserto' | 'defeito'
  grades jsonb NOT NULL DEFAULT '{}'::jsonb,
  grade_total integer NOT NULL DEFAULT 0,
  destino_defeito varchar(20),          -- só p/ defeito: '2_lote' | 'cancelado'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cq_pos_variantes_cq   ON public.cq_pos_variantes USING btree (controle_qualidade_id);
CREATE INDEX IF NOT EXISTS idx_cq_pos_variantes_terc ON public.cq_pos_variantes USING btree (producao_terceirizado_id);

ALTER TABLE public.cq_pos_variantes ENABLE ROW LEVEL SECURITY;

-- RLS = espelho de cq_variantes: PERMISSIVE tenant (via pai) + RESTRICTIVE módulo.
DROP POLICY IF EXISTS child_all_cq_pos_variantes ON public.cq_pos_variantes;
CREATE POLICY child_all_cq_pos_variantes ON public.cq_pos_variantes
  FOR ALL
  USING (EXISTS (SELECT 1 FROM public.controle_qualidade p
                 WHERE p.id = cq_pos_variantes.controle_qualidade_id AND p.tenant_id = get_user_tenant_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.controle_qualidade p
                      WHERE p.id = cq_pos_variantes.controle_qualidade_id AND p.tenant_id = get_user_tenant_id()));

DROP POLICY IF EXISTS modgate_ins_cq_pos ON public.cq_pos_variantes;
CREATE POLICY modgate_ins_cq_pos ON public.cq_pos_variantes AS RESTRICTIVE FOR INSERT WITH CHECK (tenant_module_enabled('producao'));
DROP POLICY IF EXISTS modgate_upd_cq_pos ON public.cq_pos_variantes;
CREATE POLICY modgate_upd_cq_pos ON public.cq_pos_variantes AS RESTRICTIVE FOR UPDATE USING (tenant_module_enabled('producao'));
DROP POLICY IF EXISTS modgate_del_cq_pos ON public.cq_pos_variantes;
CREATE POLICY modgate_del_cq_pos ON public.cq_pos_variantes AS RESTRICTIVE FOR DELETE USING (tenant_module_enabled('producao'));
