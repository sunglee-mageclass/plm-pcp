-- Toggle de serviço (soft-hide) — Parte B do design MO por serviço (2026-08-06).
-- `ativo=false` some da seleção de NOVOS usos (Planejamento/PCP); usos históricos persistem.
-- Aditivo e idempotente (sem BEGIN/COMMIT: um único ADD COLUMN IF NOT EXISTS).
ALTER TABLE public.categorias_terceirizado
  ADD COLUMN IF NOT EXISTS ativo boolean NOT NULL DEFAULT true;
