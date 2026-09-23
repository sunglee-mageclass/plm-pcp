-- INVERSO de 20260930120000_kanban_auto_1_schema.sql — rodar POR ÚLTIMO (ordem 4 → 3 → 2 → 1).
-- ⚠️ DESTRUTIVO: apaga a chave `kanban_automatico` das lojas, a marca `origem`/`lote_id` do
-- histórico (as linhas continuam; só a marca some), a fila (vazia fora de uma txn) e TODOS os
-- lotes de snapshot. Antes de rodar com a chave já usada em produção: exportar
--   \copy (select * from public.kanban_snapshot) to 'kanban_snapshot.csv' csv header
--   \copy (select id, origem, lote_id from public.modelo_kanban_historico where origem <> 'manual') to 'mkh_origem.csv' csv header
-- Pré-requisito: os inversos 4, 3 e 2 já rodaram (fn_kanban_historico do snapshot não lê `origem`).
-- GUARDA DE ORDEM (fix round final): se a migration 3 ou a 2 ainda existem, RECUSA antes de tocar em
-- qualquer coisa (a txn aborta; nada é aplicado).

BEGIN;

DO $do$
BEGIN
  IF to_regprocedure('public._kanban_aplicar(uuid,uuid[],text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rode antes o inverso da migration 3 (20260930140000_kanban_auto_3_motor_down.sql).';
  END IF;
  IF to_regprocedure('public._kanban_status_gate(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rode antes o inverso da migration 2 (20260930130000_kanban_auto_2_derivacao_down.sql).';
  END IF;
END
$do$;

DROP TABLE IF EXISTS public.kanban_snapshot;
DROP TABLE IF EXISTS public.kanban_recalculo_fila;

ALTER TABLE public.modelo_kanban_historico DROP COLUMN IF EXISTS lote_id;
ALTER TABLE public.modelo_kanban_historico DROP COLUMN IF EXISTS origem;

DROP INDEX IF EXISTS public.idx_cad_tecidos_cad;
DROP INDEX IF EXISTS public.idx_cad_tecido_variantes_cad_tecido;
DROP INDEX IF EXISTS public.idx_cad_aviamentos_cad;
DROP INDEX IF EXISTS public.idx_cad_etiquetas_cad;
DROP INDEX IF EXISTS public.idx_modelo_aviamentos_modelo;

ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS kanban_automatico;

COMMIT;

select pg_notify('pgrst', 'reload schema');
