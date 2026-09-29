-- Inverso de 20261015100000_config_loja_salvar_colab.sql — derruba SÓ a RPC nova `salvar_config_loja`.
-- ⚠️ Reverter o FRONT antes (o front novo da Config da Loja salva só por esta RPC; sem ela o Salvar dá erro).
-- Sem DDL em tenant_config (DROP FUNCTION não trava a tabela); nenhuma outra função é tocada. Idempotente (IF EXISTS).
-- Dados gravados pela RPC ficam (são colunas que já existiam).
-- Ordem (LIFO): esta volta roda ANTES das voltas de 20261014100000 (Tamanho em) e 20261013100000 (cor no nome) —
-- não depende de nenhuma delas (nenhuma função em comum).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DROP FUNCTION IF EXISTS public.salvar_config_loja(uuid, jsonb, jsonb, boolean);

NOTIFY pgrst, 'reload schema';
COMMIT;
