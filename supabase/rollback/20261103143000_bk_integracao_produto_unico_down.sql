-- Inverso NEUTRO de supabase/migrations/20261103143000_bk_integracao_produto_unico.sql (Frente Backend B4). Escrito a mao.
-- Plano: .superpowers/sdd/2026-10-05-backend/plan.md (GC 8, §0 K9, §4 B4, §13.4).
-- NO-OP DOCUMENTADO: indice nao tem forma "neutra" sem DDL (DROP INDEX pega AccessExclusive em integracao_linhas). O indice
-- integracao_linhas_produto_unico FICA: e inofensivo (nenhum escritor grava 2 linhas 'produto' do mesmo card; o site velho nao
-- muda nada). Este arquivo so confere o estado (guarda) e avisa por NOTICE. Para REMOVER de fato: o _down_drop (opcional,
-- depois, LIFO). Sem trava de tabela, sem DROP. Mantem a forma de todo _down do kit (LIFO: depois do 145000_down, antes do 141000_down).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.integracao_linhas_produto_unico');
  IF v_def IS NOT NULL
     AND v_def <> 'CREATE UNIQUE INDEX integracao_linhas_produto_unico ON public.integracao_linhas USING btree (modelo_id) WHERE (tipo = ''produto''::text)' THEN
    RAISE EXCEPTION 'bk4_down: indice com outra definicao (%) - outra frente mexeu', v_def USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'bk4_down: o indice fica; para remover use o _down_drop';
END
$guarda$;

COMMIT;
