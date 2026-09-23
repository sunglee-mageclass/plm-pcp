-- INVERSO de 20260930150000_kanban_auto_4_rpcs.sql — rodar PRIMEIRO (ordem 4 → 3 → 2 → 1).
-- Só derruba as 5 RPCs novas (nenhum dado é tocado). Sem kanban_definir_automatico, ninguém liga/desliga
-- a chave enquanto a trava (migration 3) existir. Depois de rodar, o front F2/F3 que chama
-- estas RPCs quebra — reverter o front ANTES (ou junto).

BEGIN;

DROP FUNCTION IF EXISTS public.kanban_restaurar(uuid);
DROP FUNCTION IF EXISTS public.kanban_previa_restauracao(uuid);
DROP FUNCTION IF EXISTS public.kanban_definir_automatico(boolean);
DROP FUNCTION IF EXISTS public.kanban_previa_recalculo(jsonb);
DROP FUNCTION IF EXISTS public.kanban_mover(uuid, text);

COMMIT;

select pg_notify('pgrst', 'reload schema');
