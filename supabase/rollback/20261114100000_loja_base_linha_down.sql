-- Inverso de supabase/migrations/20261114100000_loja_base_linha.sql (F2 Tarefa A).
BEGIN;
DROP FUNCTION IF EXISTS public.loja_base_linha_ler(uuid);
DROP FUNCTION IF EXISTS public._loja_base_linha_ler_core(uuid, uuid);
DROP TABLE IF EXISTS public.loja_direcionamento_base_linha;  -- cascateia policies/indices
NOTIFY pgrst, 'reload schema';
COMMIT;
