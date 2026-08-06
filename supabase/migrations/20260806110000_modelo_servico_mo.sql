-- MO por serviço — Parte A (2026-08-06): tabela modelo_servico_mo + backfill do legado.
-- Idempotente; envolve backfill em BEGIN/COMMIT (consolida dado de produção).
-- Escrita só por RPC DEFINER (Task 4); por isso NÃO há policy de INSERT/UPDATE/DELETE.
-- Leitura de VALOR é custo → gated pela RPC modelo_mo_resumo; por isso também NÃO há
-- policy de SELECT ampla (evita vazar valor a quem não pode ver custos — invariante #12).
BEGIN;

CREATE TABLE IF NOT EXISTS public.modelo_servico_mo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id),
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  categoria_terceirizado_id uuid REFERENCES public.categorias_terceirizado(id) ON DELETE RESTRICT,
  valor numeric NOT NULL DEFAULT 0,
  aprovado boolean,                       -- NULL = pendente / true / false
  motivo_reprovacao text,
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE composta (segura p/ embed): 1 linha por modelo×serviço.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='modelo_servico_mo_modelo_categoria_key') THEN
    ALTER TABLE public.modelo_servico_mo
      ADD CONSTRAINT modelo_servico_mo_modelo_categoria_key UNIQUE (modelo_id, categoria_terceirizado_id);
  END IF;
END $$;

-- No máx. 1 legado (categoria NULL) por modelo (UNIQUE composta não cobre NULL).
CREATE UNIQUE INDEX IF NOT EXISTS ux_msm_legado
  ON public.modelo_servico_mo (modelo_id) WHERE categoria_terceirizado_id IS NULL;

-- Índices de apoio.
CREATE INDEX IF NOT EXISTS idx_msm_modelo ON public.modelo_servico_mo (modelo_id);
CREATE INDEX IF NOT EXISTS idx_msm_tenant ON public.modelo_servico_mo (tenant_id);

-- RLS: liga; sem policy de escrita (RPC DEFINER) e sem SELECT amplo (valor é custo).
ALTER TABLE public.modelo_servico_mo ENABLE ROW LEVEL SECURITY;

-- set_tenant_id no INSERT (mesmo trigger padrão das outras tabelas de negócio).
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.modelo_servico_mo;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.modelo_servico_mo
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- Backfill "Geral (legado)": 1 linha (categoria NULL) por modelo com MO/aprovação atual.
-- valor = lump (custo_simulado.mao_obra, senão custo_terceirizados_previsto).
-- aprovado = estado atual EXATO do modelo (pode ser null/true/false).
-- Idempotente: só insere onde não há legado (ON CONFLICT no índice parcial não é acionável
-- por WHERE — usamos NOT EXISTS).
INSERT INTO public.modelo_servico_mo
  (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado, motivo_reprovacao)
SELECT m.tenant_id, m.id, NULL,
       COALESCE(NULLIF((m.custo_simulado->>'mao_obra')::numeric, 0), m.custo_terceirizados_previsto, 0),
       m.custo_terceirizados_aprovado,
       m.motivo_reprovacao_mao_obra
FROM public.modelos m
WHERE (
    COALESCE(NULLIF((m.custo_simulado->>'mao_obra')::numeric, 0), 0) > 0
    OR COALESCE(m.custo_terceirizados_previsto, 0) > 0
    OR m.custo_terceirizados_aprovado = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.modelo_servico_mo s
    WHERE s.modelo_id = m.id AND s.categoria_terceirizado_id IS NULL
  );

COMMIT;
