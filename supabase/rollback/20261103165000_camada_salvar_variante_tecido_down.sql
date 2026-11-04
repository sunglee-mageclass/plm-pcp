-- Inverso de 20261103165000_camada_salvar_variante_tecido.sql (Tarefa 2 do "Salvar por card" do Plan. Tecido).
-- Remove as 3 funcoes criadas (wrapper primeiro, depois _core e o helper de assinatura). Nao ha tabela, coluna nem gatilho
-- novos: nada de dado para devolver. Volta LIFO: reverter o SITE (o front novo chama a RPC) ANTES; a Tarefa 3, se ja
-- aplicada nesta mesma migration, acrescenta aqui o DROP das funcoes de previa (`variante_tecido_preco_previa` e o `_core`).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';

DROP FUNCTION IF EXISTS public.salvar_variante_tecido(uuid, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public._salvar_variante_tecido_core(uuid, jsonb, jsonb);
DROP FUNCTION IF EXISTS public._variante_tecido_preco_assinatura_ok(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.variante_tecido_preco_previa(uuid, numeric);
DROP FUNCTION IF EXISTS public._variante_tecido_preco_previa_core(uuid, numeric);

COMMIT;
