-- Achados LEVES, release L9 - CORRECAO UNICA (SEPARADA) do fin #8, P-206 A (dono 01/out): congela o PRECO DE HOJE nos itens
-- de OC que estao sem preco (NULL), para o valor da OC deixar de seguir o cadastro:
--   * OC de AVIAMENTO: TODO item com preco vazio (recebida E encomendada) recebe aviamentos.preco de hoje. Por que tambem as
--     encomendadas: depois da 20261029100000 todo save grava o preco do item; um item vazio numa OC aberta seguiria o
--     cadastro so ate o proximo save (valor "flutuante" por tempo indeterminado, sem ninguem ver). Congelar agora da o
--     MESMO numero que a tela ja mostra hoje e tira a dupla semantica. Encomendada nao tem parcela (o gatilho so gera ao
--     receber), entao nada de financeiro muda nelas.
--   * OC de TECIDO RECEBIDA: item com preco vazio recebe COALESCE(variantes_tecido.preco, artigos.preco) - o MESMO que a
--     tela da OC Tecido pre-preenche ao abrir e grava no proximo save (entrada-saida.oc-tecido.tsx, "pre-preenche o preco
--     de CADA item com o preco ATUAL da variante"). Inclui rolos e itens cancelados (os 41 do plano). Encomendadas de
--     tecido ficam fora (escopo da P-206 A; a tela ja as preenche ao abrir).
--   Item cujo cadastro tambem nao tem preco fica vazio (vale 0, como hoje) e e contado no NOTICE.
-- Efeitos colaterais (todos pelo caminho normal do sistema, nenhum gatilho e desligado):
--   * OC de aviamento RECEBIDA: o gatilho do item (trg_recalc_parcelas_aviamento) recalcula as parcelas NAO pagas. Valor =
--     o de hoje pelo preco do cadastro; so muda se as parcelas estavam desatualizadas (previa: avi_ocs_parc_mudam; copia 0).
--   * Item de tecido: a fila de custo (trg_custo_fila_upd em ocs_tecido_itens) recalcula no COMMIT o custo previsto dos
--     modelos INTERNOS NAO cortados vinculados ao item (o preco do tecido passa a vir da OC, regra "custo congelado pela OC";
--     copia: 14 modelos, 1 muda R$ 0,01 por arredondamento kg->m). Cortados nao mudam (P-169 A).
--   * rev das OCs tocadas sobe (fn_colab_bump_*): tela aberta faz o merge de sempre. Rodar em horario calmo.
-- PREVIA OBRIGATORIA NO KIT: supabase/consultas/l9_preco_previa.sql (READ ONLY + ROLLBACK), DEPOIS da 20261029100000.
-- Guarda por contagem: com algo a congelar, a sessao TEM de trazer as contagens aprovadas da previa -
--   psql -v ON_ERROR_STOP=1 -c "SET app.l9_esperado_avi='<avi_congelar>'" -c "SET app.l9_esperado_tec='<tec_congelar>'" -f <arquivo>
--   (o arquivo reconta COM as linhas travadas e recusa P0001 se mudou). Nada a congelar = no-op (idempotente; sem GUC).
-- Backup p/ a volta: public._bkp_l9_preco_congelado (tabela, item_id, oc_id, ..., preco_depois); RLS ligada SEM policy +
-- REVOKE ALL de PUBLIC/anon/authenticated (so o dono do banco le). Reaplicar = recongela so o que estiver vazio (upsert).
-- Volta: supabase/rollback/20261029110000_oc_preco_congelar_correcao_unica_down.sql (devolve NULL SO onde o preco ainda e o
-- congelado; preco editado depois fica). LIFO: este inverso roda ANTES do de 20261029100000.
-- Guarda: exige a 20261029100000 aplicada (coluna + os textos de depois das funcoes que leem o preco).
-- Autor na auditoria = quem roda (sem JWT = Sistema). Travas: FOR UPDATE nos itens alvo (ORDER BY id); nada em auth/storage.
-- Aplicar fora de transacao, DEPOIS da 20261029100000 (e da previa). NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '30s';
SET LOCAL transaction_timeout = '60s';

DO $guarda$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ocs_aviamento_itens'
                   AND column_name = 'preco' AND data_type = 'numeric') THEN
    RAISE EXCEPTION 'leves_l9 (correcao): a 20261029100000 nao esta aplicada (falta ocs_aviamento_itens.preco)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.gerar_parcelas_oc_aviamento()', '11f384d54071402055205fd2ad66f2c6'),
      ('public._recalcular_parcelas_core(uuid,text)', 'cdd88638886087b9fd71a631be1035f1'),
      ('public._dashboard_financeiro_core(date,date)', 'c6069728c11a900047531eb4e1f5e920'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', 'cd78ec5bb7e2570db19f41c84584bfcc')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l9 (correcao): % nao esta com o texto da 20261029100000 - aplicar a ida antes', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE TABLE IF NOT EXISTS public._bkp_l9_preco_congelado (
  tabela        text        NOT NULL CHECK (tabela IN ('ocs_aviamento_itens', 'ocs_tecido_itens')),
  item_id       uuid        NOT NULL,
  oc_id         uuid        NOT NULL,
  tenant_id     uuid,
  oc_status     text,
  preco_depois  numeric     NOT NULL,
  congelado_em  timestamptz NOT NULL DEFAULT now(),
  revertido_em  timestamptz,
  PRIMARY KEY (tabela, item_id)
);
COMMENT ON TABLE public._bkp_l9_preco_congelado IS
  'L9 (P-206 A): itens de OC que estavam com preco NULL e receberam o preco de hoje na correcao unica 20261029110000. A volta devolve NULL onde o preco ainda e preco_depois.';
ALTER TABLE public._bkp_l9_preco_congelado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_l9_preco_congelado FROM PUBLIC, anon, authenticated;

DO $corrige$
DECLARE
  v_avi integer;
  v_tec integer;
  v_avi_sem integer;
  v_tec_sem integer;
  v_esp_avi text := NULLIF(current_setting('app.l9_esperado_avi', true), '');
  v_esp_tec text := NULLIF(current_setting('app.l9_esperado_tec', true), '');
  v_n_avi integer := 0;
  v_n_tec integer := 0;
  v_ocs_receb integer;
BEGIN
  -- trava os itens candidatos (ordem por id) ANTES de contar: a contagem guardada e a que sera gravada.
  PERFORM 1 FROM public.ocs_aviamento_itens it WHERE it.preco IS NULL ORDER BY it.id FOR UPDATE OF it;
  PERFORM 1 FROM public.ocs_tecido_itens it JOIN public.ocs_tecido o ON o.id = it.oc_tecido_id AND o.status = 'recebido'
   WHERE it.preco IS NULL ORDER BY it.id FOR UPDATE OF it;

  CREATE TEMP TABLE IF NOT EXISTS _l9_alvo (tabela text, item_id uuid, oc_id uuid, tenant_id uuid, oc_status text, p numeric)
    ON COMMIT DROP;
  DELETE FROM _l9_alvo;
  INSERT INTO _l9_alvo
  SELECT 'ocs_aviamento_itens', it.id, o.id, o.tenant_id, o.status::text, a.preco
    FROM public.ocs_aviamento_itens it
    JOIN public.ocs_aviamento o ON o.id = it.oc_aviamento_id
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
   WHERE it.preco IS NULL
  UNION ALL
  SELECT 'ocs_tecido_itens', it.id, o.id, o.tenant_id, o.status::text, COALESCE(vt.preco, ar.preco)
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido o ON o.id = it.oc_tecido_id AND o.status = 'recebido'
    LEFT JOIN public.artigos ar ON ar.id = it.artigo_id
    LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
   WHERE it.preco IS NULL;

  SELECT count(*) FILTER (WHERE tabela = 'ocs_aviamento_itens' AND p IS NOT NULL),
         count(*) FILTER (WHERE tabela = 'ocs_tecido_itens' AND p IS NOT NULL),
         count(*) FILTER (WHERE tabela = 'ocs_aviamento_itens' AND p IS NULL),
         count(*) FILTER (WHERE tabela = 'ocs_tecido_itens' AND p IS NULL),
         count(DISTINCT oc_id) FILTER (WHERE tabela = 'ocs_aviamento_itens' AND p IS NOT NULL AND oc_status = 'recebido')
    INTO v_avi, v_tec, v_avi_sem, v_tec_sem, v_ocs_receb
    FROM _l9_alvo;

  IF v_avi = 0 AND v_tec = 0 THEN
    RAISE NOTICE 'leves_l9 (correcao): nada a congelar (aviamento 0, tecido 0; sem preco no cadastro: % / %) - no-op', v_avi_sem, v_tec_sem;
    RETURN;
  END IF;
  IF v_esp_avi IS NULL OR v_esp_tec IS NULL THEN
    RAISE EXCEPTION 'leves_l9 (correcao): falta SET app.l9_esperado_avi / app.l9_esperado_tec com as contagens da previa (agora: aviamento %, tecido %)', v_avi, v_tec
      USING ERRCODE = 'P0001';
  END IF;
  IF v_esp_avi IS DISTINCT FROM v_avi::text OR v_esp_tec IS DISTINCT FROM v_tec::text THEN
    RAISE EXCEPTION 'leves_l9 (correcao): contagem diferente da previa aprovada (aviamento % x esperado %, tecido % x esperado %) - rodar a previa de novo e conferir com o dono', v_avi, v_esp_avi, v_tec, v_esp_tec
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public._bkp_l9_preco_congelado AS b (tabela, item_id, oc_id, tenant_id, oc_status, preco_depois)
  SELECT t.tabela, t.item_id, t.oc_id, t.tenant_id, t.oc_status, t.p FROM _l9_alvo t WHERE t.p IS NOT NULL
  ON CONFLICT (tabela, item_id) DO UPDATE
    SET oc_id = EXCLUDED.oc_id, tenant_id = EXCLUDED.tenant_id, oc_status = EXCLUDED.oc_status,
        preco_depois = EXCLUDED.preco_depois, congelado_em = now(), revertido_em = NULL;

  UPDATE public.ocs_aviamento_itens it SET preco = t.p
    FROM _l9_alvo t
   WHERE t.tabela = 'ocs_aviamento_itens' AND t.item_id = it.id AND t.p IS NOT NULL AND it.preco IS NULL;
  GET DIAGNOSTICS v_n_avi = ROW_COUNT;
  UPDATE public.ocs_tecido_itens it SET preco = t.p
    FROM _l9_alvo t
   WHERE t.tabela = 'ocs_tecido_itens' AND t.item_id = it.id AND t.p IS NOT NULL AND it.preco IS NULL;
  GET DIAGNOSTICS v_n_tec = ROW_COUNT;

  IF v_n_avi <> v_avi OR v_n_tec <> v_tec THEN
    RAISE EXCEPTION 'leves_l9 (correcao): gravou % / % (esperado % / %) - nada muda', v_n_avi, v_n_tec, v_avi, v_tec USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'leves_l9 (correcao): aviamento % item(ns) congelado(s) (% OC(s) recebida(s) com parcelas recalculadas); tecido % item(ns); sem preco no cadastro (ficam vazios): aviamento %, tecido %',
    v_n_avi, v_ocs_receb, v_n_tec, v_avi_sem, v_tec_sem;
END $corrige$;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ocs_aviamento_itens it JOIN public.aviamentos a ON a.id = it.aviamento_id
              WHERE it.preco IS NULL AND a.preco IS NOT NULL) THEN
    RAISE EXCEPTION 'leves_l9 (correcao): pos-condicao falhou - ainda ha item de aviamento vazio com preco no cadastro' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ocs_tecido_itens it JOIN public.ocs_tecido o ON o.id = it.oc_tecido_id AND o.status = 'recebido'
              LEFT JOIN public.artigos ar ON ar.id = it.artigo_id LEFT JOIN public.variantes_tecido vt ON vt.id = it.variante_tecido_id
              WHERE it.preco IS NULL AND COALESCE(vt.preco, ar.preco) IS NOT NULL) THEN
    RAISE EXCEPTION 'leves_l9 (correcao): pos-condicao falhou - ainda ha item de tecido recebido vazio com preco no cadastro' USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public._bkp_l9_preco_congelado', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_l9_preco_congelado', 'SELECT')
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public._bkp_l9_preco_congelado'::regclass) THEN
    RAISE EXCEPTION 'leves_l9 (correcao): pos-condicao falhou - backup legivel por anon/authenticated ou sem RLS' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
