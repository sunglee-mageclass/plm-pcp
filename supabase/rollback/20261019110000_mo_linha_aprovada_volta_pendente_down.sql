-- INVERSO de supabase/migrations/20261019110000_mo_linha_aprovada_volta_pendente.sql (contas certas, item 8, P-163 A).
-- Recoloca enforce_servico_mo_aprovacao com o texto EXATO que estava vivo antes da ida (copia em
-- public._bkp_funcoes_contas_certas): mudar o valor de uma linha aprovada volta a NAO reabrir a aprovacao.
-- Linhas que a ida ja voltou para pendente CONTINUAM pendentes (dado nao e desfeito; precisam ser aprovadas de novo).
-- Guarda: so roda se o texto vivo e EXATAMENTE o da ida (md5 a2115ce0538b76b7cbe1740a6227bd2e); outro -> P0001, nada muda.
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
    RAISE EXCEPTION 'contas_certas_8 (volta): _bkp_funcoes_contas_certas nao existe - a 20261019110000 nao foi aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- public.enforce_servico_mo_aprovacao()
  v_sig := 'public.enforce_servico_mo_aprovacao()';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'contas_certas_8 (volta): % nao existe', v_sig USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM 'a2115ce0538b76b7cbe1740a6227bd2e' THEN
    RAISE EXCEPTION 'contas_certas_8 (volta): % nao esta com o texto da 20261019110000 (md5 %) - nada a desfazer ou outra frente mexeu', v_sig, v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT b.definicao, b.md5 INTO v_def, v_md5_antes FROM public._bkp_funcoes_contas_certas b
   WHERE b.migracao = '20261019110000' AND b.assinatura = v_sig;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contas_certas_8 (volta): copia do texto de antes de % nao encontrada em _bkp_funcoes_contas_certas', v_sig USING ERRCODE = 'P0001';
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(to_regprocedure(v_sig))) IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'contas_certas_8 (volta): % nao voltou ao texto guardado', v_sig USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public._bkp_funcoes_contas_certas WHERE migracao = '20261019110000';

END $volta$;

NOTIFY pgrst, 'reload schema';
COMMIT;
