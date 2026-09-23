-- Kanban automático — F1 · migration 1/4: SCHEMA (aditiva, idempotente)
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 5–6, §3).
-- Inverso pareado: supabase/rollback/20260930120000_kanban_auto_1_schema_down.sql.
--
-- 1) 5 índices que faltavam nas tabelas-filhas lidas pelo core de condições.
-- 2) modelo_kanban_historico ganha `origem` (manual|auto|config|restauracao; linhas antigas =
--    'manual') e `lote_id` (lote do snapshot que gerou a linha) — desfazer seletivo (G-inicial #1).
-- 3) kanban_recalculo_fila — fila do recálculo ADIADO p/ o COMMIT (esvazia no próprio COMMIT).
-- 4) kanban_snapshot — colunas de ANTES de ligar/mudar a config (restaurar com prévia).
-- 5) tenant_config.kanban_automatico — a CHAVE por loja, DESLIGADA por padrão (decisão 4).
-- ORDEM (G-plano R1): o ALTER de tenant_config pega AccessExclusive numa tabela que as policies RLS
-- de TODAS as lojas leem → fica POR ÚLTIMO, logo antes do COMMIT, p/ segurar o lock o mínimo.
-- `REFERENCES public.modelos` (fila e snapshot) pega SHARE ROW EXCLUSIVE em `modelos` (barra
-- escrita, não leitura) até o COMMIT. O apply em produção roda com lock_timeout (Task 18).
-- As 2 tabelas novas: RLS LIGADA, SEM policy e REVOKE ALL de PUBLIC/anon/authenticated →
-- invisíveis ao PostgREST; só as funções SECURITY DEFINER (dono postgres) leem/escrevem.
-- Sem policy de SELECT de propósito: a prévia/restauração é via RPC DEFINER (Task 16) e uma
-- policy sem GRANT seria código morto — e exporia o snapshot a quem não é admin se alguém
-- desse GRANT depois. As duas têm `tenant_id` → `_wipe_tenant_core` já as cobre.

BEGIN;

-- 1) Índices faltantes (tabelas pequenas → CREATE INDEX comum dentro da txn)
CREATE INDEX IF NOT EXISTS idx_cad_tecidos_cad ON public.cad_tecidos (cad_id);
CREATE INDEX IF NOT EXISTS idx_cad_tecido_variantes_cad_tecido ON public.cad_tecido_variantes (cad_tecido_id);
CREATE INDEX IF NOT EXISTS idx_cad_aviamentos_cad ON public.cad_aviamentos (cad_id);
CREATE INDEX IF NOT EXISTS idx_cad_etiquetas_cad ON public.cad_etiquetas (cad_id);
CREATE INDEX IF NOT EXISTS idx_modelo_aviamentos_modelo ON public.modelo_aviamentos (modelo_id);

-- 2) Histórico: origem + lote
ALTER TABLE public.modelo_kanban_historico
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual'
    CONSTRAINT modelo_kanban_historico_origem_chk
    CHECK (origem IN ('manual', 'auto', 'config', 'restauracao'));
ALTER TABLE public.modelo_kanban_historico
  ADD COLUMN IF NOT EXISTS lote_id uuid;

-- 3) Fila do recálculo adiado
CREATE TABLE IF NOT EXISTS public.kanban_recalculo_fila (
  modelo_id uuid PRIMARY KEY REFERENCES public.modelos(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  criado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kanban_fila_tenant ON public.kanban_recalculo_fila (tenant_id);
ALTER TABLE public.kanban_recalculo_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kanban_recalculo_fila FROM PUBLIC, anon, authenticated;

-- 4) Snapshot p/ desfazer
CREATE TABLE IF NOT EXISTS public.kanban_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id         uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  modelo_id       uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  status_anterior text,
  motivo          text NOT NULL CONSTRAINT kanban_snapshot_motivo_chk CHECK (motivo IN ('ligar', 'config')),
  criado_at       timestamptz NOT NULL DEFAULT now(),
  restaurado_at   timestamptz,
  CONSTRAINT kanban_snapshot_lote_modelo_uk UNIQUE (lote_id, modelo_id)
);
CREATE INDEX IF NOT EXISTS idx_kanban_snapshot_tenant ON public.kanban_snapshot (tenant_id, criado_at DESC);
CREATE INDEX IF NOT EXISTS idx_kanban_snapshot_modelo ON public.kanban_snapshot (modelo_id);
ALTER TABLE public.kanban_snapshot ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kanban_snapshot FROM PUBLIC, anon, authenticated;

-- 5) Chave por loja — POR ÚLTIMO (R1): AccessExclusive de tenant_config só até o COMMIT abaixo
ALTER TABLE public.tenant_config
  ADD COLUMN IF NOT EXISTS kanban_automatico boolean NOT NULL DEFAULT false;

COMMIT;

select pg_notify('pgrst', 'reload schema');
