-- Inverso NEUTRO de supabase/migrations/20261103145000_bk_opcoes_colecao.sql (Frente Backend F2.1). Escrito a mao.
-- Plano: .superpowers/sdd/2026-10-05-backend/plan.md (GC 8, §0 K9, §6 F2.1, §13.4).
-- NO-OP DOCUMENTADO: a RPC nova public.opcoes_colecao_modelos() nao tem forma "neutra" (nao existia antes) e o unico jeito de
-- tira-la e DROP, que fica no _down_drop separado. A RPC FICA, inerte: e so leitura, o site velho nao a chama. Este arquivo so
-- confere o estado (guarda) e avisa por NOTICE. Sem DROP, sem trava de tabela. Mantem a forma de todo _down do kit (LIFO: depois
-- do 146000_down, se houver; antes do 143000_down).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v_ida constant text := 'e81c8269e75912056e885700d30e3e18';
  v_md5 text;
BEGIN
  SELECT md5(pg_get_functiondef(to_regprocedure('public.opcoes_colecao_modelos()'))) INTO v_md5;
  IF v_md5 IS NOT NULL AND v_md5 <> v_ida THEN
    RAISE EXCEPTION 'bk_f21_down: opcoes_colecao_modelos() com outro texto (md5 %) - outra frente mexeu', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'bk_f21_down: a RPC opcoes_colecao_modelos() fica (inerte); para remover use o _down_drop';
END
$guarda$;

COMMIT;
