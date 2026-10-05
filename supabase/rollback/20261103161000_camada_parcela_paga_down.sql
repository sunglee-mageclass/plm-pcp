-- Inverso NEUTRO de supabase/migrations/20261103161000_camada_parcela_paga.sql - GERADO por .superpowers/sdd/2026-10-05-camada/mig/gerar-c1.mjs (nunca editar a mao).
-- A funcao do gatilho vira passa-direto (RETURN OLD): volta o comportamento de antes (a cascata leva as parcelas). O gatilho
-- FICA (so catalogo: sem trava de tabela, sem DROP). Remover de fato = supabase/rollback/20261103161000_camada_parcela_paga_down_drop.sql (opcional, depois). Re-ida aceita o neutro.
--   public.fn_servico_parcela_paga_bloqueia_delete()  IDA 8e5618da90c83c2e788e0c9f6f8794ad  NEUTRO 7a6dd9a7e13c300569c162808081bf7f
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
  n int;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()')));
  IF v IS NOT NULL AND v NOT IN ('8e5618da90c83c2e788e0c9f6f8794ad', '7a6dd9a7e13c300569c162808081bf7f') THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down: public.fn_servico_parcela_paga_bloqueia_delete() com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  -- se o gatilho ja existe, e o nosso (mesma funcao, BEFORE DELETE FOR EACH ROW, ligado)
  SELECT count(*) INTO n FROM pg_trigger g WHERE g.tgrelid = 'public.producao_terceirizados'::regclass AND g.tgname = 'trg_servico_parcela_paga_bloqueia_delete'
     AND (g.tgfoid <> to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') OR g.tgtype <> 11 OR g.tgenabled <> 'O');
  IF n > 0 THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down: gatilho trg_servico_parcela_paga_bloqueia_delete existe com outra definicao' USING ERRCODE = 'P0001';
  END IF;
  -- colunas usadas pela funcao seguem existindo
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND ((table_name = 'parcelas_servico' AND column_name IN ('producao_terceirizado_id', 'status', 'data_pagamento', 'numero_parcela'))
      OR (table_name = 'producao_terceirizados' AND column_name IN ('id', 'categoria_terceirizado_id', 'empresa_id', 'colaborador_id')));
  IF n <> 8 THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down: colunas de parcelas_servico/producao_terceirizados mudaram (% de 8)', n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $existe$
BEGIN
  IF to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') IS NULL THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down: public.fn_servico_parcela_paga_bloqueia_delete() ausente (ida nunca rodou ou _down_drop ja rodou) - nada a fazer'
      USING ERRCODE = 'P0001';
  END IF;
END
$existe$;

CREATE OR REPLACE FUNCTION public.fn_servico_parcela_paga_bloqueia_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [camada C1 / P-268 A] NEUTRO (inverso 20261103161000_down): o gatilho segue ligado, mas so deixa passar (comportamento de antes:
-- a FK ON DELETE CASCADE leva as parcelas). Remover de fato = 20261103161000_down_drop (opcional, depois, horario calmo).
BEGIN
  RETURN OLD;
END
$function$;

REVOKE ALL ON FUNCTION public.fn_servico_parcela_paga_bloqueia_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_servico_parcela_paga_bloqueia_delete() TO service_role;

DO $pos$
DECLARE
  n int;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()'))) IS DISTINCT FROM '7a6dd9a7e13c300569c162808081bf7f' THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down: pos-condicao falhou no texto de public.fn_servico_parcela_paga_bloqueia_delete()' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.fn_servico_parcela_paga_bloqueia_delete()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.fn_servico_parcela_paga_bloqueia_delete()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') AND x.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()')
                 AND (p.prosecdef OR coalesce(array_to_string(p.proconfig, '|'), '') <> 'search_path=public')) THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down: pos-condicao falhou na ACL/secdef/search_path de public.fn_servico_parcela_paga_bloqueia_delete()' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger g WHERE g.tgrelid = 'public.producao_terceirizados'::regclass AND g.tgname = 'trg_servico_parcela_paga_bloqueia_delete'
     AND g.tgfoid = to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') AND g.tgtype = 11 AND g.tgenabled = 'O';
  IF n <> 1 THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga_down: pos-condicao falhou no gatilho trg_servico_parcela_paga_bloqueia_delete' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
