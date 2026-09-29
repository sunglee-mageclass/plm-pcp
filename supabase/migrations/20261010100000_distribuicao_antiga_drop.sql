-- Distribuicao antiga -- Parte 2 (banco): REMOVE os objetos da tela /distribuicao antiga (P-111 A). DESTRUTIVA.
-- O front que usava estes objetos foi APAGADO na F5b (0259d781) e esta no ar desde 29/set 10h08 (worker 9e4dc812).
-- A Distribuicao NOVA (plan_tecido_variantes.distribuicao, direcionamento_plano_modelo, migration 20261006100000)
-- NAO e tocada aqui.
--
-- Some:
--   * tabela public.distribuicao_tabelas (+ pkey, indice idx_distribuicao_tabelas_tenant_colecao, gatilho
--     set_tenant_id_distribuicao, policy distribuicao_tabelas_tenant, 2 FKs -> tenants/colecoes)
--   * RPC public.distribuicao_resumo(uuid, text)
--   * RPC public.salvar_distribuicao_tabela(jsonb)
--   * RPC public.excluir_distribuicao_tabela(uuid)
--   * RPC public.direcionamento_resumo_subcolecao(uuid)   (morta: lia a tabela antiga; o Direcionamento usa
--     direcionamento_plano_modelo desde 20261006100000)
-- Contagem esperada: -4 funcoes, -1 gatilho, -1 policy, -1 tabela em public. Nenhuma outra funcao e redefinida:
-- _wipe_tenant_core apaga por LOOP dinamico em information_schema (a tabela so sai da lista); fn_audit/reset_loja/
-- excluir_loja nao citam a tabela; a tabela nao esta em publication (realtime) nem tem FK apontando para ela.
--
-- Dados: a migration NAO copia os dados. O kit (savepoints/pre-dist-parte2/kit/ida-dist-parte2.sh) faz pg_dump da
-- tabela (estrutura + dados) ANTES de aplicar. Inverso: supabase/rollback/20261010100000_distribuicao_antiga_drop_down.sql
-- (recria estrutura + 4 funcoes byte a byte); os dados voltam do dump do kit.
--
-- Travas (medidas na copia 29/set): o DROP TABLE pega AccessExclusiveLock em public.tenants e public.colecoes (pelas
-- FKs) ate o COMMIT -- nada em auth/storage/realtime. Por isso o DROP TABLE vem por ULTIMO, lock_timeout curto e o
-- kit repete a tentativa se der 55P03. Idempotente (IF EXISTS): rodar 2x nao falha.
-- Mensagens de RAISE so ASCII (PostgREST/5xx). NUNCA aplicar com \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';

-- ---------------------------------------------------------------------------------------------------------------
-- Guarda: se QUALQUER outro objeto vivo usar a tabela/RPCs antigas, PARA (nada e removido).
-- ---------------------------------------------------------------------------------------------------------------
DO $guarda$
DECLARE
  v_re   constant text := '(distribuicao_tabelas|distribuicao_resumo|salvar_distribuicao_tabela|excluir_distribuicao_tabela|direcionamento_resumo_subcolecao)';
  v_lista text;
  v_n     int;
BEGIN
  -- (a) corpo de funcao (sem comentarios --) fora das 4 que saem
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_lista
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
    AND p.prosrc IS NOT NULL
    AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* v_re
    AND NOT (n.nspname = 'public' AND p.proname IN ('distribuicao_resumo', 'salvar_distribuicao_tabela',
                                                    'excluir_distribuicao_tabela', 'direcionamento_resumo_subcolecao'));
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop: funcao viva ainda usa a Distribuicao antiga (%) - nada foi removido', v_lista
      USING ERRCODE = 'P0001';
  END IF;

  -- (b) views / materialized views
  SELECT string_agg(s || '.' || v, ', ') INTO v_lista FROM (
    SELECT schemaname AS s, viewname AS v FROM pg_views WHERE definition ~* v_re
    UNION ALL
    SELECT schemaname, matviewname FROM pg_matviews WHERE definition ~* v_re
  ) x;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop: view usa a Distribuicao antiga (%) - nada foi removido', v_lista
      USING ERRCODE = 'P0001';
  END IF;

  -- (c) policy de OUTRA tabela
  SELECT string_agg(schemaname || '.' || tablename || ':' || policyname, ', ') INTO v_lista
  FROM pg_policies
  WHERE tablename <> 'distribuicao_tabelas'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* v_re;
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop: policy usa a Distribuicao antiga (%) - nada foi removido', v_lista
      USING ERRCODE = 'P0001';
  END IF;

  -- (d) FK de outra tabela apontando para a tabela antiga
  IF to_regclass('public.distribuicao_tabelas') IS NOT NULL THEN
    SELECT string_agg(conrelid::regclass::text || ':' || conname, ', ') INTO v_lista
    FROM pg_constraint
    WHERE confrelid = 'public.distribuicao_tabelas'::regclass AND conrelid <> 'public.distribuicao_tabelas'::regclass;
    IF v_lista IS NOT NULL THEN
      RAISE EXCEPTION 'distribuicao_antiga_drop: FK aponta para distribuicao_tabelas (%) - nada foi removido', v_lista
        USING ERRCODE = 'P0001';
    END IF;

    -- (e) estrutura esperada (12 colunas): se mudou, alguem mexeu -- PARA
    SELECT count(*) INTO v_n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'distribuicao_tabelas';
    IF v_n <> 12 THEN
      RAISE EXCEPTION 'distribuicao_antiga_drop: distribuicao_tabelas tem % colunas (esperado 12) - nada foi removido', v_n
        USING ERRCODE = 'P0001';
    END IF;

    -- (f) publication (realtime): o DROP tira sozinho; so avisa
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE schemaname = 'public' AND tablename = 'distribuicao_tabelas') THEN
      RAISE NOTICE 'distribuicao_antiga_drop: distribuicao_tabelas estava em publication (sai junto com o DROP)';
    END IF;
  END IF;

  -- (g) pg_cron (se existir): job citando os nomes
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT string_agg(jobid::text, '', '') FROM cron.job WHERE command ~* $1' INTO v_lista USING v_re;
    IF v_lista IS NOT NULL THEN
      RAISE EXCEPTION 'distribuicao_antiga_drop: job do pg_cron usa a Distribuicao antiga (jobid %) - nada foi removido', v_lista
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------------------
-- Remocao: RPCs primeiro (assinaturas exatas, sem CASCADE), a TABELA por ultimo (trava tenants/colecoes so ate o COMMIT).
-- Sem CASCADE: qualquer dependencia nao prevista faz o DROP falhar e a transacao inteira volta.
-- ---------------------------------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.direcionamento_resumo_subcolecao(uuid);
DROP FUNCTION IF EXISTS public.distribuicao_resumo(uuid, text);
DROP FUNCTION IF EXISTS public.salvar_distribuicao_tabela(jsonb);
DROP FUNCTION IF EXISTS public.excluir_distribuicao_tabela(uuid);
DROP TABLE IF EXISTS public.distribuicao_tabelas;

-- ---------------------------------------------------------------------------------------------------------------
-- Pos-condicao: tudo sumiu e a Distribuicao NOVA segue de pe. Qualquer divergencia desfaz TUDO.
-- ---------------------------------------------------------------------------------------------------------------
DO $pos$
BEGIN
  IF to_regclass('public.distribuicao_tabelas') IS NOT NULL
     OR to_regprocedure('public.distribuicao_resumo(uuid,text)') IS NOT NULL
     OR to_regprocedure('public.salvar_distribuicao_tabela(jsonb)') IS NOT NULL
     OR to_regprocedure('public.excluir_distribuicao_tabela(uuid)') IS NOT NULL
     OR to_regprocedure('public.direcionamento_resumo_subcolecao(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop: pos-condicao falhou - objeto antigo ainda existe - desfazendo tudo'
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.direcionamento_plano_modelo(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                      AND table_name = 'plan_tecido_variantes' AND column_name = 'distribuicao') THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop: pos-condicao falhou - Distribuicao nova ausente - desfazendo tudo'
      USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'distribuicao_antiga_drop: OK - tabela distribuicao_tabelas e 4 RPCs antigas removidas';
END $pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
