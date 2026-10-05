-- DROP separado de supabase/migrations/20261103145000_bk_opcoes_colecao.sql (Frente Backend F2.1). OPCIONAL, depois do _down e
-- SO com o SITE ja voltado (o site novo chama a RPC: PCP > Etapas e Dashboard > Comercial ficariam sem opcoes de Colecao).
-- Escrito a mao. Plano: .superpowers/sdd/2026-10-05-backend/plan.md (GC 8, §0 K9, §6 F2.1, §13.4).
-- Remove public.opcoes_colecao_modelos(). RECUSA (P0001) se: a funcao existir com outro texto (outra frente mexeu); ou alguma
-- OUTRA funcao de public citar o nome (\y fronteira) - quem chama tem de sair antes. Ja removida = nada a fazer.
-- Trava: so catalogo (DROP FUNCTION = AccessExclusive no objeto funcao; nenhuma tabela). Nada em auth/storage/realtime.
-- Em ate 1500ms (lock_timeout); 55P03/40P01 = nada mudou, rodar de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $drop$
DECLARE
  v_ida constant text := 'e81c8269e75912056e885700d30e3e18';
  v_oid oid := to_regprocedure('public.opcoes_colecao_modelos()');
  v_md5 text;
  v_quem text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE NOTICE 'bk_f21_drop: opcoes_colecao_modelos() ja removida - nada a fazer';
    RETURN;
  END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 <> v_ida THEN
    RAISE EXCEPTION 'bk_f21_drop: opcoes_colecao_modelos() com outro texto (md5 %) - outra frente mexeu', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_quem
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.oid <> v_oid
     AND p.prosrc ~ '\yopcoes_colecao_modelos\y';
  IF v_quem IS NOT NULL THEN
    RAISE EXCEPTION 'bk_f21_drop: funcoes ainda citam opcoes_colecao_modelos: %', v_quem USING ERRCODE = 'P0001';
  END IF;
  DROP FUNCTION public.opcoes_colecao_modelos();
END
$drop$;

DO $pos$
BEGIN
  IF to_regprocedure('public.opcoes_colecao_modelos()') IS NOT NULL THEN
    RAISE EXCEPTION 'bk_f21_drop: pos-condicao falhou (funcao ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

-- PostgREST recarrega o cache de schema (a RPC aparece/some na API sem esperar o reload periodico).
NOTIFY pgrst, 'reload schema';

COMMIT;
