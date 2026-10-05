-- Urgentes R3 T13 - log estoque_mov_log: data/quem de cada mudanca do "a separar / a enviar" DEPOIS do envio ao PCP, daqui em
-- diante. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a3.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-a.md (Task 13; Rulings A15, A16, A17, A19).
-- O que muda (objetos NOVOS; nenhuma funcao existente e redefinida):
--   1) tabela NOVA public.estoque_mov_log (ledger): tenant_id, familia ('aviamento'|'insumo'), cad_id, item_id (aviamento/etiqueta),
--      variante_id (variante de aviamento CRUA), cor_id (insumo), antes/depois (contribuicao ao estoque), ept_antes/ept_depois
--      (insumo: enviar_por_tamanho), txid (txid_current()), created_at (now()), created_by (auth.uid()). Indice (tenant_id, familia,
--      item_id, created_at). RLS LIGADA SEM policy + REVOKE ALL de PUBLIC, anon, authenticated (ACL final {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}):
--      so funcao DEFINER le/escreve (ledger - S2/S5). Sem FK (o cad pode ser excluido; o leitor ignora orfao). Tem tenant_id: o laco
--      dinamico do _wipe_tenant_core (reset/excluir loja) a apaga sozinho.
--   2) public.fn_estoque_mov_log() (plpgsql, SECURITY DEFINER, search_path=public, EXECUTE revogado de PUBLIC, anon, authenticated).
--   3) 6 gatilhos AFTER INSERT | UPDATE | DELETE, FOR EACH STATEMENT com tabelas de transicao (um evento por gatilho - regra do PG),
--      trg_estoque_mov_log_ins / _upd / _del em public.cad_aviamentos e em public.cad_etiquetas.
-- Grava 1 linha por linha afetada cujo cad.enviado_corte = true e cuja contribuicao mudou: aviamento =
-- COALESCE(NULLIF(quantidade_separar, 0), quantidade_enviar, 0) (a MESMA expressao do baixa_cad do _estoque_aviamento_core);
-- insumo = quantidade_enviar e enviar_por_tamanho crus (o extrato aplica a regra do _estoque_etiqueta_core). INSERT => antes 0; DELETE =>
-- depois 0; UPDATE casado por id (chave cad/item/variante/cor mudou => sai da velha + entra na nova). O DELETE+INSERT do Salvar do CAD
-- (salvar_cad_completo) na MESMA txn gera -X/+Y com o mesmo txid. CAD nao enviado, cascata do cad excluido e o _wipe_tenant_core
-- (session_replication_role = replica) nao logam. O MOMENTO do envio, do recebimento de OC e da OS baixada vem do audit_log que ja existe
-- (Ruling A16) - nada novo aqui. Nenhum dado existente muda; nada e retroativo (so mudancas DEPOIS desta migration).
-- Custo: MEDIDO na copia (maior loja, Ave Rara: 118 CADs com aviamento/insumo, 1632 linhas, TODOS dados como enviados - pior caso;
-- Salvar = DELETE + INSERT linha a linha nas 2 tabelas, como o salvar_cad_completo): ~5 ms a mais por Salvar de um CAD inteiro
-- (~14 linhas) com o log vivo x neutro; 2 linhas de log por linha com contribuicao a cada Salvar (-X/+X, soma 0). CAD nao enviado
-- (a maioria) so paga o join no cad (tests/integration/urg-a3-mov-log.test.ts).
-- Trava: CREATE TRIGGER (e CREATE OR REPLACE TRIGGER ao reaplicar) = ShareRowExclusiveLock em public.cad_aviamentos e
-- public.cad_etiquetas ate o COMMIT (MEDIDO na copia, supautils carregado, por diferenca de pg_locks, na 1a ida E ao reaplicar; CREATE
-- TABLE/ENABLE RLS/REVOKE so travam a propria tabela nova; NADA em auth/storage/realtime):
-- bloqueia ESCRITA dessas 2 tabelas (Salvar do Sheet/CAD, Explosao, envio a Explosao, receber OC de P. Acabado) por ms; leitura segue.
-- A tabela nova (so na 1a vez) pega AccessExclusive nela mesma (ninguem a usa ainda). lock_timeout 1500ms - 55P03 = nada mudou, rodar
-- o arquivo de novo. HORARIO CALMO. Idempotente (tabela so e criada se faltar; CREATE OR REPLACE da funcao e dos gatilhos).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_estoque_mov_log()  DEPOIS b50b96f26df262c55a4a9085e56bbb10  NEUTRO 910a696b98994505c5257369bb9df434
--   (ANTES: ausente) - confere public._estoque_aviamento_core(uuid) com a expressao do baixa_cad (md5 na geracao f6eea9360a5fee924824a323de47c53f).
-- ====================================================================================
-- Volta (LIFO): supabase/rollback/20261103176000_urg_r3_estoque_mov_log_down.sql (NEUTRALIZA a funcao: CREATE OR REPLACE, sem trava de tabela; os
-- gatilhos e a tabela ficam, inertes; as linhas gravadas ficam) - depois do _down da 177000 e ANTES do 20261103175000_down. DROP de
-- verdade: supabase/rollback/20261103176000_urg_r3_estoque_mov_log_down_drop.sql (opcional, depois, HORARIO CALMO: DROP TRIGGER prende auth/storage/realtime
-- ate o COMMIT; a TABELA so cai com SET LOCAL app.confirmo_apagar_estoque_mov_log = 'sim' na mesma transacao).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
  n int;
BEGIN
  IF position('COALESCE(NULLIF(ca.quantidade_separar, 0), ca.quantidade_enviar, 0)' IN coalesce(pg_get_functiondef(to_regprocedure('public._estoque_aviamento_core(uuid)')), '')) = 0 THEN
    RAISE EXCEPTION 'urg_r3_176000: public._estoque_aviamento_core(uuid) mudou a contribuicao do baixa_cad (o log espelha COALESCE(NULLIF(ca.quantidade_separar, 0), ca.quantidade_enviar, 0)) - gere de novo' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cad'
        AND ((column_name = 'enviado_corte' AND data_type = 'boolean') OR (column_name = 'tenant_id' AND data_type = 'uuid'))) <> 2 THEN
    RAISE EXCEPTION 'urg_r3_176000: public.cad sem enviado_corte/tenant_id?!' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_estoque_mov_log()')));
  IF v IS NOT NULL AND v NOT IN ('b50b96f26df262c55a4a9085e56bbb10', '910a696b98994505c5257369bb9df434') THEN
    RAISE EXCEPTION 'urg_r3_176000: public.fn_estoque_mov_log() com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT t.tgrelid::regclass::text AS tab, t.tgname FROM pg_trigger t
            WHERE t.tgrelid IN ('public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass) AND t.tgname IN ('trg_estoque_mov_log_ins', 'trg_estoque_mov_log_upd', 'trg_estoque_mov_log_del')
              AND t.tgfoid IS DISTINCT FROM to_regprocedure('public.fn_estoque_mov_log()') LOOP
    RAISE EXCEPTION 'urg_r3_176000: gatilho % de % ja existe chamando outra funcao - outra frente mexeu', r.tgname, r.tab USING ERRCODE = 'P0001';
  END LOOP;
  IF to_regclass('public.estoque_mov_log') IS NOT NULL THEN
    SELECT count(*) INTO n FROM (
      SELECT a.attname::text AS col, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.estoque_mov_log'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      EXCEPT
      SELECT * FROM (VALUES
        ('id', 'uuid', true, 'gen_random_uuid()'),
        ('tenant_id', 'uuid', true, NULL::text),
        ('familia', 'text', true, NULL::text),
        ('cad_id', 'uuid', true, NULL::text),
        ('item_id', 'uuid', true, NULL::text),
        ('variante_id', 'uuid', false, NULL::text),
        ('cor_id', 'uuid', false, NULL::text),
        ('antes', 'numeric', true, NULL::text),
        ('depois', 'numeric', true, NULL::text),
        ('ept_antes', 'jsonb', false, NULL::text),
        ('ept_depois', 'jsonb', false, NULL::text),
        ('txid', 'bigint', true, 'txid_current()'),
        ('created_at', 'timestamp with time zone', true, 'now()'),
        ('created_by', 'uuid', false, 'auth.uid()')
      ) AS e(col, tipo, nn, def)
    ) x;
    IF n > 0 OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.estoque_mov_log'::regclass AND a.attnum > 0 AND NOT a.attisdropped) <> 14 THEN
      RAISE EXCEPTION 'urg_r3_176000: public.estoque_mov_log com forma inesperada (colunas) - outra frente mexeu; gere de novo' USING ERRCODE = 'P0001';
    END IF;
    END IF;
END
$guarda$;

DO $cria$
BEGIN
  IF to_regclass('public.estoque_mov_log') IS NULL THEN
    CREATE TABLE public.estoque_mov_log (
      id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
      tenant_id uuid NOT NULL,
      familia text NOT NULL CONSTRAINT estoque_mov_log_familia_chk CHECK (familia IN ('aviamento', 'insumo')),
      cad_id uuid NOT NULL,
      item_id uuid NOT NULL,
      variante_id uuid NULL,
      cor_id uuid NULL,
      antes numeric NOT NULL,
      depois numeric NOT NULL,
      ept_antes jsonb NULL,
      ept_depois jsonb NULL,
      txid bigint NOT NULL DEFAULT txid_current(),
      created_at timestamptz NOT NULL DEFAULT now(),
      created_by uuid NULL DEFAULT auth.uid()
    );
    CREATE INDEX idx_estoque_mov_log_item ON public.estoque_mov_log (tenant_id, familia, item_id, created_at);
    ALTER TABLE public.estoque_mov_log ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.estoque_mov_log FROM PUBLIC, anon, authenticated;
    COMMENT ON TABLE public.estoque_mov_log IS
      'Log (urg R3 T13, 20261103176000) das mudancas do a separar (cad_aviamentos) / a enviar (cad_etiquetas) de CAD ja enviado ao PCP, daqui em diante: antes/depois da contribuicao ao estoque por linha (aviamento = expressao do baixa_cad do _estoque_aviamento_core; insumo = quantidade_enviar + enviar_por_tamanho crus), quando, quem e txid. Gravada SO por fn_estoque_mov_log (gatilho DEFINER); RLS sem policy + sem grant para PUBLIC/anon/authenticated: so funcao DEFINER le. Sem FK (o cad pode ser excluido; o leitor ignora orfao). Ledger: nunca editar.';
  END IF;
END
$cria$;

CREATE OR REPLACE FUNCTION public.fn_estoque_mov_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R3 T13] Log das mudancas do "a separar" (cad_aviamentos) e do "a enviar" (cad_etiquetas) de CAD JA ENVIADO ao PCP
-- (cad.enviado_corte = true, join no cad - a loja vem dele), DAQUI EM DIANTE: guarda quando (created_at), quem (created_by =
-- auth.uid()) e a transacao (txid) de cada mudanca que o Extrato de estoque (T14) explica. Gatilhos de STATEMENT com tabelas de
-- transicao (novas/antigas), um por evento, nas 2 tabelas. Contribuicao do aviamento = a MESMA expressao do baixa_cad do
-- _estoque_aviamento_core; do insumo = quantidade_enviar e enviar_por_tamanho CRUS (o extrato aplica a regra do
-- _estoque_etiqueta_core). INSERT => antes 0; DELETE => depois 0; UPDATE casado por id: mesma chave (cad, item, variante, cor) =>
-- 1 linha so se a contribuicao mudou; chave mudou => sai da velha (depois 0) e entra na nova (antes 0). Linha sem contribuicao
-- (0 e enviar_por_tamanho vazio) nao entra nem sai. O DELETE+INSERT do Salvar do CAD na MESMA txn gera -X/+Y com o mesmo txid (o
-- leitor soma por txid). Cascata do cad excluido nao loga (o cad ja sumiu no join), como o core, que tambem o tira.
BEGIN
  IF TG_TABLE_NAME = 'cad_aviamentos' THEN
    IF TG_OP = 'INSERT' THEN
      WITH o AS (SELECT x.id, x.cad_id AS cad, x.aviamento_id AS item, x.variante_aviamento_id AS var, NULL::uuid AS cor, COALESCE(NULLIF(x.quantidade_separar, 0), x.quantidade_enviar, 0) AS v, NULL::jsonb AS ept
                   FROM novas x WHERE false),
           n AS (SELECT x.id, x.cad_id AS cad, x.aviamento_id AS item, x.variante_aviamento_id AS var, NULL::uuid AS cor, COALESCE(NULLIF(x.quantidade_separar, 0), x.quantidade_enviar, 0) AS v, NULL::jsonb AS ept
                   FROM novas x),
           p AS (SELECT o.id AS o_id, o.cad AS o_cad, o.item AS o_item, o.var AS o_var, o.cor AS o_cor, o.v AS o_v, o.ept AS o_ept,
                        n.id AS n_id, n.cad AS n_cad, n.item AS n_item, n.var AS n_var, n.cor AS n_cor, n.v AS n_v, n.ept AS n_ept
                   FROM o FULL JOIN n ON n.id = o.id),
           m AS (SELECT p.n_cad AS cad, p.n_item AS item, p.n_var AS var, p.n_cor AS cor, p.o_v AS antes, p.n_v AS depois,
                        p.o_ept AS ept_antes, p.n_ept AS ept_depois
                   FROM p
                  WHERE p.o_id IS NOT NULL AND p.n_id IS NOT NULL
                    AND (p.o_cad, p.o_item, p.o_var, p.o_cor) IS NOT DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor)
                    AND (p.o_v, p.o_ept) IS DISTINCT FROM (p.n_v, p.n_ept)
                 UNION ALL
                 SELECT p.o_cad, p.o_item, p.o_var, p.o_cor, p.o_v, 0, p.o_ept, NULL
                   FROM p
                  WHERE p.o_id IS NOT NULL
                    AND (p.n_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.o_v <> 0 OR coalesce(p.o_ept, '{}'::jsonb) <> '{}'::jsonb)
                 UNION ALL
                 SELECT p.n_cad, p.n_item, p.n_var, p.n_cor, 0, p.n_v, NULL, p.n_ept
                   FROM p
                  WHERE p.n_id IS NOT NULL
                    AND (p.o_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.n_v <> 0 OR coalesce(p.n_ept, '{}'::jsonb) <> '{}'::jsonb))
      INSERT INTO public.estoque_mov_log (tenant_id, familia, cad_id, item_id, variante_id, cor_id, antes, depois, ept_antes, ept_depois)
      SELECT c.tenant_id, 'aviamento', m.cad, m.item, m.var, m.cor, m.antes, m.depois, m.ept_antes, m.ept_depois
        FROM m
        JOIN public.cad c ON c.id = m.cad AND c.enviado_corte
       WHERE m.item IS NOT NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      WITH o AS (SELECT x.id, x.cad_id AS cad, x.aviamento_id AS item, x.variante_aviamento_id AS var, NULL::uuid AS cor, COALESCE(NULLIF(x.quantidade_separar, 0), x.quantidade_enviar, 0) AS v, NULL::jsonb AS ept
                   FROM antigas x),
           n AS (SELECT x.id, x.cad_id AS cad, x.aviamento_id AS item, x.variante_aviamento_id AS var, NULL::uuid AS cor, COALESCE(NULLIF(x.quantidade_separar, 0), x.quantidade_enviar, 0) AS v, NULL::jsonb AS ept
                   FROM novas x),
           p AS (SELECT o.id AS o_id, o.cad AS o_cad, o.item AS o_item, o.var AS o_var, o.cor AS o_cor, o.v AS o_v, o.ept AS o_ept,
                        n.id AS n_id, n.cad AS n_cad, n.item AS n_item, n.var AS n_var, n.cor AS n_cor, n.v AS n_v, n.ept AS n_ept
                   FROM o FULL JOIN n ON n.id = o.id),
           m AS (SELECT p.n_cad AS cad, p.n_item AS item, p.n_var AS var, p.n_cor AS cor, p.o_v AS antes, p.n_v AS depois,
                        p.o_ept AS ept_antes, p.n_ept AS ept_depois
                   FROM p
                  WHERE p.o_id IS NOT NULL AND p.n_id IS NOT NULL
                    AND (p.o_cad, p.o_item, p.o_var, p.o_cor) IS NOT DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor)
                    AND (p.o_v, p.o_ept) IS DISTINCT FROM (p.n_v, p.n_ept)
                 UNION ALL
                 SELECT p.o_cad, p.o_item, p.o_var, p.o_cor, p.o_v, 0, p.o_ept, NULL
                   FROM p
                  WHERE p.o_id IS NOT NULL
                    AND (p.n_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.o_v <> 0 OR coalesce(p.o_ept, '{}'::jsonb) <> '{}'::jsonb)
                 UNION ALL
                 SELECT p.n_cad, p.n_item, p.n_var, p.n_cor, 0, p.n_v, NULL, p.n_ept
                   FROM p
                  WHERE p.n_id IS NOT NULL
                    AND (p.o_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.n_v <> 0 OR coalesce(p.n_ept, '{}'::jsonb) <> '{}'::jsonb))
      INSERT INTO public.estoque_mov_log (tenant_id, familia, cad_id, item_id, variante_id, cor_id, antes, depois, ept_antes, ept_depois)
      SELECT c.tenant_id, 'aviamento', m.cad, m.item, m.var, m.cor, m.antes, m.depois, m.ept_antes, m.ept_depois
        FROM m
        JOIN public.cad c ON c.id = m.cad AND c.enviado_corte
       WHERE m.item IS NOT NULL;
    ELSE
      WITH o AS (SELECT x.id, x.cad_id AS cad, x.aviamento_id AS item, x.variante_aviamento_id AS var, NULL::uuid AS cor, COALESCE(NULLIF(x.quantidade_separar, 0), x.quantidade_enviar, 0) AS v, NULL::jsonb AS ept
                   FROM antigas x),
           n AS (SELECT x.id, x.cad_id AS cad, x.aviamento_id AS item, x.variante_aviamento_id AS var, NULL::uuid AS cor, COALESCE(NULLIF(x.quantidade_separar, 0), x.quantidade_enviar, 0) AS v, NULL::jsonb AS ept
                   FROM antigas x WHERE false),
           p AS (SELECT o.id AS o_id, o.cad AS o_cad, o.item AS o_item, o.var AS o_var, o.cor AS o_cor, o.v AS o_v, o.ept AS o_ept,
                        n.id AS n_id, n.cad AS n_cad, n.item AS n_item, n.var AS n_var, n.cor AS n_cor, n.v AS n_v, n.ept AS n_ept
                   FROM o FULL JOIN n ON n.id = o.id),
           m AS (SELECT p.n_cad AS cad, p.n_item AS item, p.n_var AS var, p.n_cor AS cor, p.o_v AS antes, p.n_v AS depois,
                        p.o_ept AS ept_antes, p.n_ept AS ept_depois
                   FROM p
                  WHERE p.o_id IS NOT NULL AND p.n_id IS NOT NULL
                    AND (p.o_cad, p.o_item, p.o_var, p.o_cor) IS NOT DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor)
                    AND (p.o_v, p.o_ept) IS DISTINCT FROM (p.n_v, p.n_ept)
                 UNION ALL
                 SELECT p.o_cad, p.o_item, p.o_var, p.o_cor, p.o_v, 0, p.o_ept, NULL
                   FROM p
                  WHERE p.o_id IS NOT NULL
                    AND (p.n_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.o_v <> 0 OR coalesce(p.o_ept, '{}'::jsonb) <> '{}'::jsonb)
                 UNION ALL
                 SELECT p.n_cad, p.n_item, p.n_var, p.n_cor, 0, p.n_v, NULL, p.n_ept
                   FROM p
                  WHERE p.n_id IS NOT NULL
                    AND (p.o_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.n_v <> 0 OR coalesce(p.n_ept, '{}'::jsonb) <> '{}'::jsonb))
      INSERT INTO public.estoque_mov_log (tenant_id, familia, cad_id, item_id, variante_id, cor_id, antes, depois, ept_antes, ept_depois)
      SELECT c.tenant_id, 'aviamento', m.cad, m.item, m.var, m.cor, m.antes, m.depois, m.ept_antes, m.ept_depois
        FROM m
        JOIN public.cad c ON c.id = m.cad AND c.enviado_corte
       WHERE m.item IS NOT NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'cad_etiquetas' THEN
    IF TG_OP = 'INSERT' THEN
      WITH o AS (SELECT x.id, x.cad_id AS cad, x.etiqueta_id AS item, NULL::uuid AS var, x.cor_id AS cor, coalesce(x.quantidade_enviar, 0) AS v, x.enviar_por_tamanho AS ept
                   FROM novas x WHERE false),
           n AS (SELECT x.id, x.cad_id AS cad, x.etiqueta_id AS item, NULL::uuid AS var, x.cor_id AS cor, coalesce(x.quantidade_enviar, 0) AS v, x.enviar_por_tamanho AS ept
                   FROM novas x),
           p AS (SELECT o.id AS o_id, o.cad AS o_cad, o.item AS o_item, o.var AS o_var, o.cor AS o_cor, o.v AS o_v, o.ept AS o_ept,
                        n.id AS n_id, n.cad AS n_cad, n.item AS n_item, n.var AS n_var, n.cor AS n_cor, n.v AS n_v, n.ept AS n_ept
                   FROM o FULL JOIN n ON n.id = o.id),
           m AS (SELECT p.n_cad AS cad, p.n_item AS item, p.n_var AS var, p.n_cor AS cor, p.o_v AS antes, p.n_v AS depois,
                        p.o_ept AS ept_antes, p.n_ept AS ept_depois
                   FROM p
                  WHERE p.o_id IS NOT NULL AND p.n_id IS NOT NULL
                    AND (p.o_cad, p.o_item, p.o_var, p.o_cor) IS NOT DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor)
                    AND (p.o_v, p.o_ept) IS DISTINCT FROM (p.n_v, p.n_ept)
                 UNION ALL
                 SELECT p.o_cad, p.o_item, p.o_var, p.o_cor, p.o_v, 0, p.o_ept, NULL
                   FROM p
                  WHERE p.o_id IS NOT NULL
                    AND (p.n_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.o_v <> 0 OR coalesce(p.o_ept, '{}'::jsonb) <> '{}'::jsonb)
                 UNION ALL
                 SELECT p.n_cad, p.n_item, p.n_var, p.n_cor, 0, p.n_v, NULL, p.n_ept
                   FROM p
                  WHERE p.n_id IS NOT NULL
                    AND (p.o_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.n_v <> 0 OR coalesce(p.n_ept, '{}'::jsonb) <> '{}'::jsonb))
      INSERT INTO public.estoque_mov_log (tenant_id, familia, cad_id, item_id, variante_id, cor_id, antes, depois, ept_antes, ept_depois)
      SELECT c.tenant_id, 'insumo', m.cad, m.item, m.var, m.cor, m.antes, m.depois, m.ept_antes, m.ept_depois
        FROM m
        JOIN public.cad c ON c.id = m.cad AND c.enviado_corte
       WHERE m.item IS NOT NULL;
    ELSIF TG_OP = 'UPDATE' THEN
      WITH o AS (SELECT x.id, x.cad_id AS cad, x.etiqueta_id AS item, NULL::uuid AS var, x.cor_id AS cor, coalesce(x.quantidade_enviar, 0) AS v, x.enviar_por_tamanho AS ept
                   FROM antigas x),
           n AS (SELECT x.id, x.cad_id AS cad, x.etiqueta_id AS item, NULL::uuid AS var, x.cor_id AS cor, coalesce(x.quantidade_enviar, 0) AS v, x.enviar_por_tamanho AS ept
                   FROM novas x),
           p AS (SELECT o.id AS o_id, o.cad AS o_cad, o.item AS o_item, o.var AS o_var, o.cor AS o_cor, o.v AS o_v, o.ept AS o_ept,
                        n.id AS n_id, n.cad AS n_cad, n.item AS n_item, n.var AS n_var, n.cor AS n_cor, n.v AS n_v, n.ept AS n_ept
                   FROM o FULL JOIN n ON n.id = o.id),
           m AS (SELECT p.n_cad AS cad, p.n_item AS item, p.n_var AS var, p.n_cor AS cor, p.o_v AS antes, p.n_v AS depois,
                        p.o_ept AS ept_antes, p.n_ept AS ept_depois
                   FROM p
                  WHERE p.o_id IS NOT NULL AND p.n_id IS NOT NULL
                    AND (p.o_cad, p.o_item, p.o_var, p.o_cor) IS NOT DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor)
                    AND (p.o_v, p.o_ept) IS DISTINCT FROM (p.n_v, p.n_ept)
                 UNION ALL
                 SELECT p.o_cad, p.o_item, p.o_var, p.o_cor, p.o_v, 0, p.o_ept, NULL
                   FROM p
                  WHERE p.o_id IS NOT NULL
                    AND (p.n_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.o_v <> 0 OR coalesce(p.o_ept, '{}'::jsonb) <> '{}'::jsonb)
                 UNION ALL
                 SELECT p.n_cad, p.n_item, p.n_var, p.n_cor, 0, p.n_v, NULL, p.n_ept
                   FROM p
                  WHERE p.n_id IS NOT NULL
                    AND (p.o_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.n_v <> 0 OR coalesce(p.n_ept, '{}'::jsonb) <> '{}'::jsonb))
      INSERT INTO public.estoque_mov_log (tenant_id, familia, cad_id, item_id, variante_id, cor_id, antes, depois, ept_antes, ept_depois)
      SELECT c.tenant_id, 'insumo', m.cad, m.item, m.var, m.cor, m.antes, m.depois, m.ept_antes, m.ept_depois
        FROM m
        JOIN public.cad c ON c.id = m.cad AND c.enviado_corte
       WHERE m.item IS NOT NULL;
    ELSE
      WITH o AS (SELECT x.id, x.cad_id AS cad, x.etiqueta_id AS item, NULL::uuid AS var, x.cor_id AS cor, coalesce(x.quantidade_enviar, 0) AS v, x.enviar_por_tamanho AS ept
                   FROM antigas x),
           n AS (SELECT x.id, x.cad_id AS cad, x.etiqueta_id AS item, NULL::uuid AS var, x.cor_id AS cor, coalesce(x.quantidade_enviar, 0) AS v, x.enviar_por_tamanho AS ept
                   FROM antigas x WHERE false),
           p AS (SELECT o.id AS o_id, o.cad AS o_cad, o.item AS o_item, o.var AS o_var, o.cor AS o_cor, o.v AS o_v, o.ept AS o_ept,
                        n.id AS n_id, n.cad AS n_cad, n.item AS n_item, n.var AS n_var, n.cor AS n_cor, n.v AS n_v, n.ept AS n_ept
                   FROM o FULL JOIN n ON n.id = o.id),
           m AS (SELECT p.n_cad AS cad, p.n_item AS item, p.n_var AS var, p.n_cor AS cor, p.o_v AS antes, p.n_v AS depois,
                        p.o_ept AS ept_antes, p.n_ept AS ept_depois
                   FROM p
                  WHERE p.o_id IS NOT NULL AND p.n_id IS NOT NULL
                    AND (p.o_cad, p.o_item, p.o_var, p.o_cor) IS NOT DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor)
                    AND (p.o_v, p.o_ept) IS DISTINCT FROM (p.n_v, p.n_ept)
                 UNION ALL
                 SELECT p.o_cad, p.o_item, p.o_var, p.o_cor, p.o_v, 0, p.o_ept, NULL
                   FROM p
                  WHERE p.o_id IS NOT NULL
                    AND (p.n_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.o_v <> 0 OR coalesce(p.o_ept, '{}'::jsonb) <> '{}'::jsonb)
                 UNION ALL
                 SELECT p.n_cad, p.n_item, p.n_var, p.n_cor, 0, p.n_v, NULL, p.n_ept
                   FROM p
                  WHERE p.n_id IS NOT NULL
                    AND (p.o_id IS NULL OR (p.o_cad, p.o_item, p.o_var, p.o_cor) IS DISTINCT FROM (p.n_cad, p.n_item, p.n_var, p.n_cor))
                    AND (p.n_v <> 0 OR coalesce(p.n_ept, '{}'::jsonb) <> '{}'::jsonb))
      INSERT INTO public.estoque_mov_log (tenant_id, familia, cad_id, item_id, variante_id, cor_id, antes, depois, ept_antes, ept_depois)
      SELECT c.tenant_id, 'insumo', m.cad, m.item, m.var, m.cor, m.antes, m.depois, m.ept_antes, m.ept_depois
        FROM m
        JOIN public.cad c ON c.id = m.cad AND c.enviado_corte
       WHERE m.item IS NOT NULL;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_estoque_mov_log() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_estoque_mov_log_ins AFTER INSERT ON public.cad_aviamentos REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_estoque_mov_log();
CREATE OR REPLACE TRIGGER trg_estoque_mov_log_upd AFTER UPDATE ON public.cad_aviamentos REFERENCING OLD TABLE AS antigas NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_estoque_mov_log();
CREATE OR REPLACE TRIGGER trg_estoque_mov_log_del AFTER DELETE ON public.cad_aviamentos REFERENCING OLD TABLE AS antigas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_estoque_mov_log();
CREATE OR REPLACE TRIGGER trg_estoque_mov_log_ins AFTER INSERT ON public.cad_etiquetas REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_estoque_mov_log();
CREATE OR REPLACE TRIGGER trg_estoque_mov_log_upd AFTER UPDATE ON public.cad_etiquetas REFERENCING OLD TABLE AS antigas NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_estoque_mov_log();
CREATE OR REPLACE TRIGGER trg_estoque_mov_log_del AFTER DELETE ON public.cad_etiquetas REFERENCING OLD TABLE AS antigas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_estoque_mov_log();

DO $pos$
DECLARE
  r record;
  n int;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_estoque_mov_log()'))) IS DISTINCT FROM 'b50b96f26df262c55a4a9085e56bbb10' THEN
    RAISE EXCEPTION 'urg_r3_176000: pos-condicao falhou no texto de public.fn_estoque_mov_log()' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_estoque_mov_log()') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.fn_estoque_mov_log()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_estoque_mov_log()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.fn_estoque_mov_log()') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r3_176000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public.fn_estoque_mov_log()' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
        WHERE t.tgrelid IN ('public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass) AND NOT t.tgisinternal
          AND t.tgfoid = to_regprocedure('public.fn_estoque_mov_log()')) <> 6
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = to_regprocedure('public.fn_estoque_mov_log()')
                  AND t.tgrelid NOT IN ('public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass)) THEN
    RAISE EXCEPTION 'urg_r3_176000: pos-condicao falhou - esperados 6 gatilhos (cad_aviamentos/cad_etiquetas) chamando public.fn_estoque_mov_log()' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.cad_aviamentos'::regclass, 'trg_estoque_mov_log_ins', 4, NULL::name, 'novas'),
      ('public.cad_aviamentos'::regclass, 'trg_estoque_mov_log_upd', 16, 'antigas', 'novas'),
      ('public.cad_aviamentos'::regclass, 'trg_estoque_mov_log_del', 8, 'antigas', NULL::name),
      ('public.cad_etiquetas'::regclass, 'trg_estoque_mov_log_ins', 4, NULL::name, 'novas'),
      ('public.cad_etiquetas'::regclass, 'trg_estoque_mov_log_upd', 16, 'antigas', 'novas'),
      ('public.cad_etiquetas'::regclass, 'trg_estoque_mov_log_del', 8, 'antigas', NULL::name)
    ) AS x(tab, nome, tipo, velha, nova) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = r.tab AND t.tgname = r.nome
                      AND t.tgfoid = to_regprocedure('public.fn_estoque_mov_log()') AND t.tgtype = r.tipo AND t.tgenabled = 'O'
                      AND t.tgoldtable IS NOT DISTINCT FROM r.velha AND t.tgnewtable IS NOT DISTINCT FROM r.nova
                      AND cardinality(t.tgattr::int2[]) = 0 AND t.tgqual IS NULL) THEN
      RAISE EXCEPTION 'urg_r3_176000: pos-condicao falhou no gatilho % de %', r.nome, r.tab USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public.estoque_mov_log') IS NULL THEN
    RAISE EXCEPTION 'urg_r3_176000: pos-condicao falhou - public.estoque_mov_log nao existe' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM (
    SELECT a.attname::text AS col, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.estoque_mov_log'::regclass AND a.attnum > 0 AND NOT a.attisdropped
    EXCEPT
    SELECT * FROM (VALUES
      ('id', 'uuid', true, 'gen_random_uuid()'),
      ('tenant_id', 'uuid', true, NULL::text),
      ('familia', 'text', true, NULL::text),
      ('cad_id', 'uuid', true, NULL::text),
      ('item_id', 'uuid', true, NULL::text),
      ('variante_id', 'uuid', false, NULL::text),
      ('cor_id', 'uuid', false, NULL::text),
      ('antes', 'numeric', true, NULL::text),
      ('depois', 'numeric', true, NULL::text),
      ('ept_antes', 'jsonb', false, NULL::text),
      ('ept_depois', 'jsonb', false, NULL::text),
      ('txid', 'bigint', true, 'txid_current()'),
      ('created_at', 'timestamp with time zone', true, 'now()'),
      ('created_by', 'uuid', false, 'auth.uid()')
    ) AS e(col, tipo, nn, def)
  ) x;
  IF n > 0 OR (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.estoque_mov_log'::regclass AND a.attnum > 0 AND NOT a.attisdropped) <> 14 THEN
    RAISE EXCEPTION 'urg_r3_176000: public.estoque_mov_log com forma inesperada (colunas) - outra frente mexeu; gere de novo' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.estoque_mov_log'::regclass AND c.relrowsecurity AND NOT c.relforcerowsecurity
                   AND coalesce(c.relacl::text, '') = '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}')
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.estoque_mov_log'::regclass)
     OR EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.estoque_mov_log'::regclass AND k.contype = 'f')
     OR (SELECT pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conrelid = 'public.estoque_mov_log'::regclass AND k.contype = 'c')
          IS DISTINCT FROM 'CHECK ((familia = ANY (ARRAY[''aviamento''::text, ''insumo''::text])))'
     OR (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i WHERE i.indrelid = 'public.estoque_mov_log'::regclass AND NOT i.indisprimary)
          IS DISTINCT FROM 'CREATE INDEX idx_estoque_mov_log_item ON public.estoque_mov_log USING btree (tenant_id, familia, item_id, created_at)'
     OR has_table_privilege('anon', 'public.estoque_mov_log', 'SELECT') OR has_table_privilege('authenticated', 'public.estoque_mov_log', 'SELECT')
     OR has_table_privilege('authenticated', 'public.estoque_mov_log', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'urg_r3_176000: pos-condicao falhou na tabela public.estoque_mov_log (RLS sem policy / ACL / CHECK / indice / sem FK)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
