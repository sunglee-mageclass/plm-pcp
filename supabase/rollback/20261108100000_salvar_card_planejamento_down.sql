-- Inverso de supabase/migrations/20261108100000_salvar_card_planejamento.sql.
-- A ida so CRIA 2 funcoes novas (a RPC salvar_card_planejamento e o helper _salvar_etiquetas_modelo_core); nenhum _core nem wrapper
-- existente foi tocado, entao NADA a restaurar: este arquivo so DROPa as duas (idempotente, IF EXISTS). Nenhum dado muda - tudo
-- que o Salvar gravou por ela e dado normal do card e fica.
-- Volta LIFO: SITE antes (o site novo chama a RPC; contra o banco sem ela o Salvar do Sheet falha com funcao inexistente).
-- Trava: so catalogo (DROP FUNCTION; nenhuma tabela, gatilho ou policy). Aplicar: psql -v ON_ERROR_STOP=1 -f <arquivo>.
-- NUNCA \i dentro de BEGIN...ROLLBACK.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DROP FUNCTION IF EXISTS public.salvar_card_planejamento(uuid, jsonb, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);
DROP FUNCTION IF EXISTS public._salvar_etiquetas_modelo_core(uuid, jsonb);

DO $post$
BEGIN
  IF to_regprocedure('public.salvar_card_planejamento(uuid,jsonb,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL
     OR to_regprocedure('public._salvar_etiquetas_modelo_core(uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'salvar_card_planejamento_down: a funcao ainda existe depois do DROP';
  END IF;
END
$post$;

COMMIT;
