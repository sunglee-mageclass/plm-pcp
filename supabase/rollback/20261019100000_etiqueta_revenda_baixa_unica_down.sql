-- INVERSO de supabase/migrations/20261019100000_etiqueta_revenda_baixa_unica.sql (contas certas, item 6).
-- Recoloca _estoque_etiqueta_core com o texto EXATO que estava vivo antes da ida (copia guardada pela ida em
-- public._bkp_funcoes_contas_certas): a revenda volta a baixar o insumo tambem depois do "Enviar para PCP" (baixa em dobro).
-- Guarda: so roda se o texto vivo e EXATAMENTE o da ida (md5 82840be36eb6cd8bc0c18e8219841d5d); outro -> P0001, nada muda.
-- Pos-condicao: md5 = o guardado; REVOKE dos TRES reafirmado. A tabela _bkp_funcoes_contas_certas fica (sem as linhas desta).
-- Ordem: LIFO da APLICACAO (se B e A forem ao ar antes de P-137/preco-anterior, a ordem de aplicacao != ordem numerica).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

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
    RAISE EXCEPTION 'contas_certas_6 (volta): _bkp_funcoes_contas_certas nao existe - a 20261019100000 nao foi aplicada' USING ERRCODE = 'P0001';
  END IF;
  -- public._estoque_etiqueta_core(uuid)
  v_sig := 'public._estoque_etiqueta_core(uuid)';
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'contas_certas_6 (volta): % nao existe', v_sig USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM '82840be36eb6cd8bc0c18e8219841d5d' THEN
    RAISE EXCEPTION 'contas_certas_6 (volta): % nao esta com o texto da 20261019100000 (md5 %) - nada a desfazer ou outra frente mexeu', v_sig, v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT b.definicao, b.md5 INTO v_def, v_md5_antes FROM public._bkp_funcoes_contas_certas b
   WHERE b.migracao = '20261019100000' AND b.assinatura = v_sig;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'contas_certas_6 (volta): copia do texto de antes de % nao encontrada em _bkp_funcoes_contas_certas', v_sig USING ERRCODE = 'P0001';
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef(to_regprocedure(v_sig))) IS DISTINCT FROM v_md5_antes THEN
    RAISE EXCEPTION 'contas_certas_6 (volta): % nao voltou ao texto guardado', v_sig USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public._bkp_funcoes_contas_certas WHERE migracao = '20261019100000';

END $volta$;

REVOKE EXECUTE ON FUNCTION public._estoque_etiqueta_core(uuid) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
