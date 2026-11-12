-- Volta da 20261125100000_peca_teste_status_lote: DROP das 2 funcoes NOVAS (wrapper + _core).
-- Sao funcoes novas desta migration (sem corpo anterior) e ninguem mais as cita -> DROP e seguro.
-- So catalogo; nenhum dado. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DROP FUNCTION IF EXISTS public.peca_teste_status_lote(uuid[]);
DROP FUNCTION IF EXISTS public._peca_teste_status_lote_core(uuid, uuid[]);

COMMIT;
