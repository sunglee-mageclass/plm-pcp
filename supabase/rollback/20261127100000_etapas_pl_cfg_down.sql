-- Volta da 20261127100000 (Kanban PL Onda 2, Task 1: cfg/ligado/derivar_lote do board PL). As 3 funcoes
-- sao NOVAS -> DROP seguro (nada na base nem na tela as chama ainda; etapas_pl_automatico default false).
-- Idempotente (IF EXISTS). Aplicar FORA de transacao: psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
DROP FUNCTION IF EXISTS public._etapas_pl_derivar_lote(uuid, uuid[], jsonb);
DROP FUNCTION IF EXISTS public._etapas_pl_ligado(uuid);
DROP FUNCTION IF EXISTS public._etapas_pl_cfg(uuid);
COMMIT;
