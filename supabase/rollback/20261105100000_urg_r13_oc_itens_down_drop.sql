-- ============================================================================
-- R13 T1 — DROP (opcional, DEPOIS do _down, em horario calmo). O DROP TABLE leva gatilhos e prende auth/storage ate o COMMIT.
--   docker exec -i supabase_db_banco-local psql -U postgres -d copia4 -v ON_ERROR_STOP=1 \
--     < supabase/rollback/20261105100000_urg_r13_oc_itens_down_drop.sql
-- Exige o _down ANTES (o ponteiro de volta no cabecalho). Protegido por GUC:
--   SET app.confirmo_apagar_itens_oc_r13 = 'sim'   (dropa as 2 tabelas de itens)
--   SET app.confirmo_apagar_backup_r13   = 'sim'   (dropa _bkp_r13_oc_vinculo)
-- SET NOT NULL em nome_produto so passa se nao houver NULL (OC nova pos-R13 nasce com nome_produto NULL).
-- ============================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

-- DROP das funcoes novas (helpers + gatilhos). IF EXISTS: idempotente.
DROP FUNCTION IF EXISTS public._oc_lote_sigla(uuid, jsonb);
DROP FUNCTION IF EXISTS public._oc_numero_proximo(text, uuid, text);
DROP FUNCTION IF EXISTS public._ocpa_item_de_produto(uuid, uuid);
DROP FUNCTION IF EXISTS public._oci_item_de_produto(uuid, uuid);
DROP FUNCTION IF EXISTS public._oc_produto_motivos(text, uuid);
DROP FUNCTION IF EXISTS public._ocpa_cabecalho_derivados(uuid);
DROP FUNCTION IF EXISTS public._oci_cabecalho_derivados(uuid);
-- os gatilhos saem junto com as tabelas (DROP TABLE); as funcoes de gatilho sao dropadas depois delas.

-- DROP das tabelas de itens (sob GUC)
DO $drop$
BEGIN
  IF coalesce(current_setting('app.confirmo_apagar_itens_oc_r13', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'r13_down_drop: defina SET app.confirmo_apagar_itens_oc_r13 = ''sim'' para dropar as tabelas de itens' USING ERRCODE='P0001';
  END IF;
  DROP TABLE IF EXISTS public.ocs_p_acabado_itens;
  DROP TABLE IF EXISTS public.ocs_importado_itens;
END $drop$;

DROP FUNCTION IF EXISTS public.fn_oc_item_produto_unico();
DROP FUNCTION IF EXISTS public.fn_oc_item_tenant();

-- SET NOT NULL de volta em nome_produto (recusa se houver NULL)
DO $nn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ocs_p_acabado WHERE nome_produto IS NULL)
     OR EXISTS (SELECT 1 FROM public.ocs_importado WHERE nome_produto IS NULL) THEN
    RAISE EXCEPTION 'r13_down_drop: ha OC com nome_produto NULL (criada pos-R13) - preencha antes do SET NOT NULL' USING ERRCODE='P0001';
  END IF;
  ALTER TABLE public.ocs_p_acabado ALTER COLUMN nome_produto SET NOT NULL;
  ALTER TABLE public.ocs_importado ALTER COLUMN nome_produto SET NOT NULL;
END $nn$;

-- backup (sob GUC propria)
DO $bkp$
BEGIN
  IF coalesce(current_setting('app.confirmo_apagar_backup_r13', true), '') = 'sim' THEN
    DROP TABLE IF EXISTS public._bkp_r13_oc_vinculo;
  END IF;
END $bkp$;

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
