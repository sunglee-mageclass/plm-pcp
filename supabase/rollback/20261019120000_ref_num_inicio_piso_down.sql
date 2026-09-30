-- INVERSO de supabase/migrations/20261019120000_ref_num_inicio_piso.sql (contas certas, item 9 + 9b, P-162 A).
-- (1) Recoloca os 3 embrulhos de REF e o _ref_num_inicio (M2) com o texto EXATO que estava vivo antes da ida (copia em
--     public._bkp_funcoes_contas_certas: pode ser o texto FIXO 10000000 ou o da fase 2 - o que estava la).
-- (2) Apaga a RPC nova ref_proximo_numero(bigint) (o front que a chama tem de voltar ANTES ou JUNTO - senao a previa da
--     Config da Loja/"+ Novo produto" cai no numero de exemplo antigo, sem quebrar a tela: o front trata erro como sem previa).
-- ⚠ A numeracao JA EMITIDA nao volta: REFs >= "Comecar em" emitidas depois da ida ficam; ref_sequencia.ultimo fica acima
--   do piso antigo e o contador so sobe (nunca reusa). Documentado (RD1).
-- Guarda: so roda se os 3 embrulhos estao EXATAMENTE com o texto da ida; outro -> P0001, nada muda.
-- Ordem: LIFO da APLICACAO. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
DECLARE
  v_sig text;
  v_md5 text;
  v_def text;
  v_md5_antes text;
BEGIN
  IF to_regclass('public._bkp_funcoes_contas_certas') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): _bkp_funcoes_contas_certas nao existe - a 20261019120000 nao foi aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- public._modelo_ref_next_num(uuid)
  v_sig := 'public._modelo_ref_next_num(uuid)';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao existe', v_sig USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM '0752dc9de192a431b7a241e10d00d58a' THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao esta com o texto da 20261019120000 (md5 %) - nada a desfazer ou outra frente mexeu', v_sig, v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT b.definicao, b.md5 INTO v_def, v_md5_antes FROM public._bkp_funcoes_contas_certas b
   WHERE b.migracao = '20261019120000' AND b.assinatura = v_sig;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): copia do texto de antes de % nao encontrada em _bkp_funcoes_contas_certas', v_sig USING ERRCODE = 'P0001';
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(to_regprocedure(v_sig))) IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao voltou ao texto guardado', v_sig USING ERRCODE = 'P0001';
  END IF;
  -- public._produto_acabado_ref_next(uuid)
  v_sig := 'public._produto_acabado_ref_next(uuid)';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao existe', v_sig USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM '83041c58e76389cab40f3f12ff5a81d0' THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao esta com o texto da 20261019120000 (md5 %) - nada a desfazer ou outra frente mexeu', v_sig, v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT b.definicao, b.md5 INTO v_def, v_md5_antes FROM public._bkp_funcoes_contas_certas b
   WHERE b.migracao = '20261019120000' AND b.assinatura = v_sig;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): copia do texto de antes de % nao encontrada em _bkp_funcoes_contas_certas', v_sig USING ERRCODE = 'P0001';
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(to_regprocedure(v_sig))) IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao voltou ao texto guardado', v_sig USING ERRCODE = 'P0001';
  END IF;
  -- public._produto_importado_ref_next(uuid)
  v_sig := 'public._produto_importado_ref_next(uuid)';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao existe', v_sig USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM '5549319a6bc74b76e7cb05c0ac37588b' THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao esta com o texto da 20261019120000 (md5 %) - nada a desfazer ou outra frente mexeu', v_sig, v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT b.definicao, b.md5 INTO v_def, v_md5_antes FROM public._bkp_funcoes_contas_certas b
   WHERE b.migracao = '20261019120000' AND b.assinatura = v_sig;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): copia do texto de antes de % nao encontrada em _bkp_funcoes_contas_certas', v_sig USING ERRCODE = 'P0001';
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(to_regprocedure(v_sig))) IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao voltou ao texto guardado', v_sig USING ERRCODE = 'P0001';
  END IF;
  -- public._ref_num_inicio(uuid)
  v_sig := 'public._ref_num_inicio(uuid)';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao existe', v_sig USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM 'addf044a5ebf27c29d533c35698db959' THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao esta com o texto da 20261019120000 (md5 %) - nada a desfazer ou outra frente mexeu', v_sig, v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT b.definicao, b.md5 INTO v_def, v_md5_antes FROM public._bkp_funcoes_contas_certas b
   WHERE b.migracao = '20261019120000' AND b.assinatura = v_sig;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): copia do texto de antes de % nao encontrada em _bkp_funcoes_contas_certas', v_sig USING ERRCODE = 'P0001';
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(to_regprocedure(v_sig))) IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'contas_certas_9 (volta): % nao voltou ao texto guardado', v_sig USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public._bkp_funcoes_contas_certas WHERE migracao = '20261019120000';

END $volta$;

DROP FUNCTION IF EXISTS public.ref_proximo_numero(bigint);

REVOKE EXECUTE ON FUNCTION public._modelo_ref_next_num(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_acabado_ref_next(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_importado_ref_next(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._ref_num_inicio(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
