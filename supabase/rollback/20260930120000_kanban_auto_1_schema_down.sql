-- INVERSO de 20260930120000_kanban_auto_1_schema.sql — rodar POR ÚLTIMO (ordem 4 → 3 → 2 → 1).
-- ⚠️ DESTRUTIVO: apaga a chave `kanban_automatico` das lojas, a marca `origem`/`lote_id` do
-- histórico (as linhas continuam; só a marca some), a fila (vazia fora de uma txn) e TODOS os
-- lotes de snapshot. Antes de rodar com a chave já usada em produção: exportar
--   \copy (select * from public.kanban_snapshot) to 'kanban_snapshot.csv' csv header
--   \copy (select id, origem, lote_id from public.modelo_kanban_historico where origem <> 'manual') to 'mkh_origem.csv' csv header
-- Pré-requisito: os inversos 4, 3 e 2 já rodaram (fn_kanban_historico do snapshot não lê `origem`).
-- GUARDA DE ORDEM (fix round final): se a migration 3 ou a 2 ainda existem, RECUSA antes de tocar em
-- qualquer coisa (a txn aborta; nada é aplicado).
-- TRAVA DO DESTRUTIVO (Task 18, runbook v2): também RECUSA se alguma loja está com a chave LIGADA ou se
-- há lote em `kanban_snapshot` ainda não restaurado (restaurado_at IS NULL) — apagar isso não tem volta.
-- Override explícito, só com OK do dono: `SET LOCAL app.kanban_inverso_forcar = 'sim';` na MESMA
-- transação, antes deste bloco (o runbook injeta logo depois do BEGIN;). Forçado = WARNING e segue.

BEGIN;

DO $do$
DECLARE
  v_forcar  boolean := coalesce(current_setting('app.kanban_inverso_forcar', true), '') = 'sim';
  v_ligadas bigint := 0;
  v_lotes   bigint := 0;
BEGIN
  IF to_regprocedure('public._kanban_aplicar(uuid,uuid[],text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rode antes o inverso da migration 3 (20260930140000_kanban_auto_3_motor_down.sql).';
  END IF;
  IF to_regprocedure('public._kanban_status_gate(uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rode antes o inverso da migration 2 (20260930130000_kanban_auto_2_derivacao_down.sql).';
  END IF;
  -- SQL dinâmico: numa 2ª rodada (idempotente) a coluna e a tabela já não existem.
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'kanban_automatico'
                AND attnum > 0 AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM public.tenant_config WHERE kanban_automatico' INTO v_ligadas;
  END IF;
  IF to_regclass('public.kanban_snapshot') IS NOT NULL THEN
    EXECUTE 'SELECT count(DISTINCT lote_id) FROM public.kanban_snapshot WHERE restaurado_at IS NULL' INTO v_lotes;
  END IF;
  IF v_ligadas > 0 OR v_lotes > 0 THEN
    IF NOT v_forcar THEN
      RAISE EXCEPTION 'Inverso 1 recusado: % loja(s) com o kanban automático LIGADO e % lote(s) de snapshot NÃO restaurado(s). Este inverso apaga a chave e os snapshots sem volta: desligue a chave e restaure as colunas de cada loja ANTES da volta.', v_ligadas, v_lotes
        USING HINT = 'Com as migrations 2–4 aplicadas: kanban_definir_automatico(false) → kanban_previa_restauracao → kanban_restaurar (runbook v2, Step 9). Se 4/3/2 já foram desfeitas, reaplique 2→3→4, desligue/restaure e refaça a volta. Para apagar mesmo assim (só com OK do dono): SET LOCAL app.kanban_inverso_forcar = ''sim'' na mesma transação.';
    END IF;
    RAISE WARNING 'Inverso 1 FORÇADO (app.kanban_inverso_forcar = sim): % loja(s) com a chave ligada e % lote(s) de snapshot não restaurado(s) serão APAGADOS.', v_ligadas, v_lotes;
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
