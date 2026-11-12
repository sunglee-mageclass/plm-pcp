-- Volta da 20261126110000 (Kanban PL Onda 1, bloco C: avaliador). As 2 funcoes sao NOVAS -> DROP seguro
-- (nada na base nem na tela as chama ainda; etapas_pl_automatico default false). Idempotente (IF EXISTS).
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
DROP FUNCTION IF EXISTS public.avaliar_condicoes_etapas_pl(uuid[]);
DROP FUNCTION IF EXISTS public._avaliar_condicoes_etapas_pl_core(uuid, uuid[]);
COMMIT;
