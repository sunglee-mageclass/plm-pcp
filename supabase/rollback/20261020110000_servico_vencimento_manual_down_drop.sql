-- INVERSO (passo 2 de 2, SEPARADO) de supabase/migrations/20261020110000_servico_vencimento_manual.sql (achados MEDIOS R10,
-- fin #6): DROP TRIGGER trg_servico_parcela_vencimento_manual + DROP da funcao do gatilho.
-- ATENCAO: DROP TRIGGER prende ~23 tabelas auth/storage/realtime (supautils.policy_grants) ate o COMMIT: HORARIO CALMO,
-- transacao curtissima. Rodar SO depois do _down (exige a funcao NEUTRA, md5 d88bb1ed58effa55eaf473c5af73be6a).
-- A coluna parcelas_servico.vencimento_manual FICA (precedente RD1).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_servico_parcela_vencimento_manual()') IS NOT NULL
     AND md5(pg_get_functiondef('public.fn_servico_parcela_vencimento_manual()'::regprocedure))
         IS DISTINCT FROM 'd88bb1ed58effa55eaf473c5af73be6a' THEN
    RAISE EXCEPTION 'medios_r10_fin6 (volta drop): a funcao do gatilho nao esta NEUTRA - rodar o _down antes' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DROP TRIGGER IF EXISTS trg_servico_parcela_vencimento_manual ON public.parcelas_servico;
DROP FUNCTION IF EXISTS public.fn_servico_parcela_vencimento_manual();

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_servico_parcela_vencimento_manual') THEN
    RAISE EXCEPTION 'medios_r10_fin6 (volta drop): gatilho ainda existe' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
