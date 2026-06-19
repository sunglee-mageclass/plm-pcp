-- BLOCO B — Workflow de Alertas de Tecido: estado explícito do alerta por item.
-- Substitui os booleans dispersos (cq_alertar_estilo/cq_estilo_ok/cq_pendente_troca)
-- por um estado único, mantendo `cancelado` como gatilho de propagação (setado em
-- conjunto pela aplicação — sem trigger, pra não conflitar com o cancelamento de
-- item encomendado da OC).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cq_alerta_status') THEN
    CREATE TYPE public.cq_alerta_status AS ENUM
      ('sem_alerta','alertado','troca_pendente','trocado','estilo_ok','cancelado','devolucao');
  END IF;
END $$;

ALTER TABLE public.ocs_tecido_itens
  ADD COLUMN IF NOT EXISTS cq_alerta_status public.cq_alerta_status NOT NULL DEFAULT 'sem_alerta',
  -- liga uma reposição (troca) ao item original. uuid simples (sem FK de propósito,
  -- pra não criar relacionamento ambíguo no PostgREST entre a mesma tabela).
  ADD COLUMN IF NOT EXISTS substitui_item_id uuid;

-- Backfill a partir dos booleans (só itens que tiveram alerta de CQ).
UPDATE public.ocs_tecido_itens SET cq_alerta_status = CASE
  WHEN cq_alertar_estilo AND cancelado          THEN 'cancelado'::public.cq_alerta_status
  WHEN cq_alertar_estilo AND cq_estilo_ok       THEN 'estilo_ok'::public.cq_alerta_status
  WHEN cq_alertar_estilo AND cq_pendente_troca  THEN 'troca_pendente'::public.cq_alerta_status
  WHEN cq_alertar_estilo                        THEN 'alertado'::public.cq_alerta_status
  ELSE 'sem_alerta'::public.cq_alerta_status
END
WHERE cq_alertar_estilo;

CREATE INDEX IF NOT EXISTS idx_oti_cq_alerta_status
  ON public.ocs_tecido_itens (cq_alerta_status)
  WHERE cq_alerta_status <> 'sem_alerta';
