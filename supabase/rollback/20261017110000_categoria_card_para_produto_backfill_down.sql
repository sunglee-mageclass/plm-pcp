-- INVERSO de supabase/migrations/20261017110000_categoria_card_para_produto_backfill.sql (P-137 A / P-144 A).
-- Devolve a cada produto alinhado pelo backfill a taxonomia de ANTES (grupo/categoria/subcategorias), lida de
-- public._bkp_p137_backfill — SO onde o produto ainda esta igual ao "depois" (edicao posterior na tela PA/PI ou pelo
-- gatilho do card NAO e desfeita; esses sao contados em nao_devolvidas). Tambem NAO devolve (M2, P-142 B) produto que
-- AGORA tem pedido quando a volta cruzaria Acessorios <-> outro grupo — contado e listado em NOTICE. Cada produto devolvido ganha 1 linha legivel no
-- audit_log ('Sistema: categoria do produto devolvida (volta da P-137)', dados {campo:{de,para}}).
-- Depois derruba a tabela de registro e as 2 funcoes do backfill, e grava o MARCADOR (tenant NULL = so o super admin ve):
-- audit_log.tabela '_bkp_p137_backfill', descricao 'p137_backfill_revertido: ...' — a ida RECUSA rodar de novo com ele,
-- salvo SET app.p137_apos_volta = 'sim' (controlador).
-- Com o gatilho da 20261017100000 ainda no ar, a volta de dado recria a divergencia (e o estado anterior) — esperado.
-- • Sem a tabela de registro (backfill nunca rodou ou volta ja rodou) = so derruba as funcoes (se houver) e sai.
-- • Lock: UPDATE de linhas em produtos_*; DROP TABLE so na tabela de registro (ninguem mais a usa).
-- • LIFO: esta volta roda ANTES do inverso da 20261017100000 (que recusa enquanto _bkp_p137_backfill existir).
-- Aplicar fora de transacao (psql -v ON_ERROR_STOP=1 -f), com o client_encoding abaixo ANTES do BEGIN.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '20s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._p137_backfill_desfazer()')));
  IF to_regclass('public._bkp_p137_backfill') IS NOT NULL AND v_md5 IS DISTINCT FROM 'ead14b02eab972e833596fd6f2cf9702' THEN
    RAISE EXCEPTION 'p137_backfill (volta): _p137_backfill_desfazer ausente ou com outro texto (md5 %) - outra frente mexeu', v_md5 USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

DO $volta$
DECLARE
  v jsonb;
BEGIN
  IF to_regclass('public._bkp_p137_backfill') IS NULL THEN
    RAISE NOTICE 'p137_backfill (volta): tabela de registro ausente - nada a devolver';
    RETURN;
  END IF;
  v := public._p137_backfill_desfazer();
  INSERT INTO public.audit_log (tenant_id, user_id, user_nome, acao, entidade, tabela, registro_id, descricao, dados)
  VALUES (NULL, NULL, 'Sistema', 'excluir', 'Backfill da P-137 (categoria do card)', '_bkp_p137_backfill', NULL,
          format('p137_backfill_revertido: backfill da P-137 DESFEITO - %s produto(s) devolvido(s) de %s registrado(s); %s ficaram como estao (editados depois ou, %s deles, com pedido e cruzando Acessorios). Ida de novo so com o controlador.',
                 v->>'devolvidas', v->>'registradas', v->>'nao_devolvidas', v->>'nao_devolvidas_acessorio_pedido'),
          NULL);
  RAISE NOTICE 'p137_backfill (volta): registradas %, devolvidas %, nao devolvidas % (editadas depois ou bloqueadas: %)',
    v->>'registradas', v->>'devolvidas', v->>'nao_devolvidas', v->'nao_devolvidas_ids';
  RAISE NOTICE 'p137_backfill (volta): % NAO devolvido(s) porque agora tem pedido e a volta cruzaria Acessorios (P-142 B): %',
    v->>'nao_devolvidas_acessorio_pedido', v->'acessorio_pedido_ids';
  RAISE NOTICE 'p137_backfill (volta): marcador gravado no audit_log - NAO rode a ida de novo sem o controlador';
END $volta$;

DROP TABLE IF EXISTS public._bkp_p137_backfill;
DROP FUNCTION IF EXISTS public._p137_backfill_rodar();
DROP FUNCTION IF EXISTS public._p137_backfill_desfazer();

DO $pos$
BEGIN
  IF to_regclass('public._bkp_p137_backfill') IS NOT NULL
     OR to_regprocedure('public._p137_backfill_rodar()') IS NOT NULL
     OR to_regprocedure('public._p137_backfill_desfazer()') IS NOT NULL THEN
    RAISE EXCEPTION 'p137_backfill (volta): pos-condicao falhou - tabela ou funcoes do backfill ainda existem' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
