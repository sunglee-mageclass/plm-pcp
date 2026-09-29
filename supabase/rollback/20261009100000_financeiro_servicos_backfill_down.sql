-- Inverso de 20261009100000_financeiro_servicos_backfill.sql — apaga EXATAMENTE as linhas financeiro_servicos que o backfill
-- inseriu (ids registrados em public._bkp_financeiro_servicos_backfill) e derruba a tabela de registro.
-- Linha que um admin regravou depois (set_user_permissions/salvar_papel apagam e reinserem com id NOVO) NÃO é tocada — é
-- decisão dele, não do backfill. Sem a tabela de registro (backfill nunca rodou, ou inverso já rodou) = não faz nada.
-- DROP TABLE pede AccessExclusive SÓ na tabela de registro (ninguém mais a usa).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '20s';

DO $volta$
DECLARE
  n_papeis   integer := 0;
  n_usuarios integer := 0;
  n_reg      integer := 0;
BEGIN
  IF to_regclass('public._bkp_financeiro_servicos_backfill') IS NULL THEN
    RAISE NOTICE 'financeiro_servicos_backfill_down: tabela de registro ausente - nada a desfazer';
    RETURN;
  END IF;
  SELECT count(*) INTO n_reg FROM public._bkp_financeiro_servicos_backfill;

  DELETE FROM public.user_permissions up
   USING public._bkp_financeiro_servicos_backfill b
   WHERE b.tabela = 'user_permissions' AND up.id = b.row_id AND up.pagina = 'financeiro_servicos';
  GET DIAGNOSTICS n_usuarios = ROW_COUNT;

  DELETE FROM public.papel_permissoes pp
   USING public._bkp_financeiro_servicos_backfill b
   WHERE b.tabela = 'papel_permissoes' AND pp.id = b.row_id AND pp.pagina = 'financeiro_servicos';
  GET DIAGNOSTICS n_papeis = ROW_COUNT;

  RAISE NOTICE 'financeiro_servicos_backfill_down: registradas %, apagadas: papeis %, usuarios % (diferenca = linha ja regravada/apagada por admin)',
    n_reg, n_papeis, n_usuarios;
END
$volta$;

DROP TABLE IF EXISTS public._bkp_financeiro_servicos_backfill;

COMMIT;
