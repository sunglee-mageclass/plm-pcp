-- Achados LEVES, release L6 (CQ, producao e completar falta) - parte 1: prod #11 + R13 "lancado".
--   producao_terceirizados.ativo e nullable (DEFAULT false) e 3 leitores tratam NULL de jeitos diferentes:
--   _resolver_fonte_confeccao (pt.ativo -> NULL NAO e fonte), _cq_liberado (COALESCE(ativo,true) -> NULL conta como pos) e
--   o ramo do lancado de fn_rebaixa_lancado_cq (t.ativo -> NULL NAO conta). Os gravadores (salvar_terceirizados) sempre
--   mandam COALESCE(...,true); a copia tem 0 linhas com NULL (o Passo 0 dos LEVES conta em producao). Esta fecha a porta:
--   ALTER COLUMN ativo SET NOT NULL. Nenhum valor gravado muda.
--
-- PRE-CONDICAO: 0 linhas com ativo NULL (contado DENTRO da transacao, logo antes do ALTER; o proprio ALTER confere de novo
--   na varredura e falha inteiro se uma linha NULL aparecer no meio). Havendo NULL -> P0001 e nada muda (corrigir antes,
--   com decisao do dono: NULL hoje e lido como ativo por _cq_liberado/_voltar_cq_para_servico_core).
-- Ja NOT NULL -> no-op (nenhuma trava de tabela; reaplicar e seguro).
--
-- TRAVA: ALTER TABLE ... SET NOT NULL pega AccessExclusiveLock em producao_terceirizados (bloqueia LEITURA e escrita) durante
--   a varredura de validacao e ate o COMMIT. Medido na copia 54422 (5 linhas, 104 kB): ver l6-report.md (ordem de ms). Em
--   producao a tabela e pequena (centenas de linhas). lock_timeout 500 ms: se alguem esta lendo/gravando Servicos/CQ no
--   instante, a migration FALHA INTEIRA (nada fica) - e so rodar de novo (idempotente); HORARIO CALMO, ate 3 tentativas
--   com alguns segundos entre elas. Nao passa pelo supautils.policy_grants (nao e DDL de policy/trigger): nao prende
--   auth/storage. Sem DROP. Sem funcao nova.
-- Volta: supabase/rollback/20261028100000_terceirizados_ativo_not_null_down.sql (DROP NOT NULL; mesma trava, instantanea -
--   so catalogo, sem varredura). LIFO: o inverso desta roda DEPOIS dos inversos 20261028120000 e 20261028110000 (e de
--   qualquer outra LEVES posterior), ANTES dos inversos da R15a e da R13.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $ida$
DECLARE
  v_notnull boolean;
  v_nulos bigint;
BEGIN
  IF to_regclass('public.producao_terceirizados') IS NULL THEN
    RAISE EXCEPTION 'leves_l6_ativo: tabela producao_terceirizados ausente' USING ERRCODE = 'P0001';
  END IF;
  SELECT a.attnotnull INTO v_notnull
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.producao_terceirizados') AND a.attname = 'ativo' AND NOT a.attisdropped;
  IF v_notnull IS NULL THEN
    RAISE EXCEPTION 'leves_l6_ativo: coluna producao_terceirizados.ativo ausente' USING ERRCODE = 'P0001';
  END IF;
  IF v_notnull THEN
    RAISE NOTICE 'leves_l6_ativo: producao_terceirizados.ativo ja e NOT NULL - nada a fazer';
    RETURN;
  END IF;
  SELECT count(*) INTO v_nulos FROM public.producao_terceirizados WHERE ativo IS NULL;
  IF v_nulos > 0 THEN
    RAISE EXCEPTION 'leves_l6_ativo: % linha(s) de producao_terceirizados com ativo NULL - corrigir antes (decisao do dono); nada mudou', v_nulos
      USING ERRCODE = 'P0001';
  END IF;
  EXECUTE 'ALTER TABLE public.producao_terceirizados ALTER COLUMN ativo SET NOT NULL';
  RAISE NOTICE 'leves_l6_ativo: producao_terceirizados.ativo agora e NOT NULL (0 linhas NULL)';
END $ida$;

DO $pos$
BEGIN
  IF NOT (SELECT a.attnotnull FROM pg_attribute a
           WHERE a.attrelid = to_regclass('public.producao_terceirizados') AND a.attname = 'ativo' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'leves_l6_ativo: pos-condicao falhou - ativo continua nullable' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
