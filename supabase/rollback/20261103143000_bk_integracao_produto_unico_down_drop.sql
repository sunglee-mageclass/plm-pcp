-- DROP separado de supabase/migrations/20261103143000_bk_integracao_produto_unico.sql (Frente Backend B4). OPCIONAL, depois do
-- _down. Escrito a mao. Plano: .superpowers/sdd/2026-10-05-backend/plan.md (GC 8, §0 K9, §4 B4, §13.4).
-- Remove o indice unico parcial public.integracao_linhas_produto_unico. RECUSA (P0001) se o indice existir com outra definicao
-- (outra frente mexeu). Ja removido = nada a fazer (sem trava).
-- Trava: DROP INDEX = AccessExclusive em public.integracao_linhas (e no proprio indice) por um instante, ate o COMMIT: bloqueia
-- leitura e escrita da tabela do espelho (tela Integracao, API, Gerar JSON) por milissegundos. Nada em auth/storage/realtime.
-- Em ate 1500ms (lock_timeout); 55P03/40P01 = nada mudou, rodar de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $drop$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def FROM pg_index i
   WHERE i.indexrelid = to_regclass('public.integracao_linhas_produto_unico');
  IF v_def IS NULL THEN
    RAISE NOTICE 'bk4_drop: indice ja removido - nada a fazer';
    RETURN;
  END IF;
  IF v_def <> 'CREATE UNIQUE INDEX integracao_linhas_produto_unico ON public.integracao_linhas USING btree (modelo_id) WHERE (tipo = ''produto''::text)' THEN
    RAISE EXCEPTION 'bk4_drop: indice com outra definicao (%) - outra frente mexeu', v_def USING ERRCODE = 'P0001';
  END IF;
  DROP INDEX public.integracao_linhas_produto_unico;
END
$drop$;

DO $pos$
BEGIN
  IF to_regclass('public.integracao_linhas_produto_unico') IS NOT NULL THEN
    RAISE EXCEPTION 'bk4_drop: pos-condicao falhou (indice ainda existe)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
