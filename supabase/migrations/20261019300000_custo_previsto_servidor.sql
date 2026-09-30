-- Contas certas, bloco C, C1 (preco A1 + BAIXA do "Aplicar"; P-166 A, P-169 A; plano .superpowers/sdd/2026-09-30-contas-certas-cd/
-- plan-cd.md §1 R-CD1..R-CD7, §2, §4 C1 e os "Rulings do controlador sobre o G-plano do delta" R1/R2, que PREVALECEM):
-- o CUSTO PREVISTO do modelo INTERNO passa a ser DERIVADO NO SERVIDOR.
--
-- Causa (conferida): modelos.custo_peca_previsto/custo_*_total e o custo_previsto das linhas do BOM eram calculados no
-- navegador e gravados no Salvar do Sheet; o banco nunca recalculava. M.O. criada/aprovada fora do Salvar, o "Aplicar" do
-- Plan. Tecido (_plan_tecido_gravar_bom_core insere modelo_tecidos com custo_previsto NULL), a replica e as mudancas de preco
-- (artigo, aviamento, insumo, item de OC vinculado) deixavam o valor velho.
--
-- Desenho (fila adiada, mesmo padrao do kanban automatico ja provado):
--   1. RC1: _precos_tecido_congelado_core(_modelo, _tenant) = o corpo de precos_tecido_congelado com a LOJA explicita (sem JWT);
--      precos_tecido_congelado(uuid) vira o embrulho (mesmo resultado via JWT, mesmo ACL). Guarda "texto de ANTES ou de DEPOIS".
--   2. Funcoes puras (alvo do anti-drift tests/fixtures/custo-bom-casos.ts): _custo_linha, _custo_adicionais_soma (R-CD6).
--   3. Preco por linha com a loja explicita: _custo_preco_tecido (congelado pela OC vinculada > MAX dos substitutos > artigo da
--      linha > 0), _custo_preco_etiqueta (MAX das variantes da cor com preco > 0 > preco base > 0; G-scripts L4). Aviamento =
--      coalesce(aviamentos.preco, 0).
--   4. _custo_calcular(_tenant, _ids): linhas (tabela, id, modelo, tipo, custo) + 1 linha 'modelos' por card com os totais
--      (tecido, forro, entretela, aviamento, etiqueta, M.O. = soma de modelo_servico_mo.valor, adicionais) e custo = peca, na
--      ordem de pecaCom. So INTERNOS da loja. _ids NULL = todos os internos da loja (uso do C2).
--   5. Aplicador _custo_recalcular_modelos(_tenant, _ids): trava os modelos em ORDER BY id (R1), liga a GUC de transacao
--      app.custo_sistema='on', UPDATE das 3 tabelas de linha e UPDATE unico em modelos, tudo com IS DISTINCT FROM (nao sobe o
--      rev a toa), e RESTAURA a GUC ao valor anterior (RC4a; precedente _kanban_aplicar).
--   6. Fila custo_recalculo_fila (RLS sem policy, REVOKE ALL) + _custo_enfileirar(_ids, _respeitar_congelado) (sai com a GUC
--      'on'; so origem 'interno'; com _respeitar_congelado pula o card ja enviado ao corte - R-CD1/P-169 A) + processador
--      fn_custo_processar_fila no CONSTRAINT TRIGGER adiado (roda no COMMIT). R1 - o processador NUNCA perde recalculo: o
--      DELETE ... RETURNING fica DENTRO do bloco protegido (falhou = a fila volta); se o lote da loja falhar, tenta card a
--      card (cada um no seu sub-bloco, WARNING ASCII por card); card que falhou FICA na fila e e refeito no proximo COMMIT da
--      loja - inclusive quando o proprio card e editado de novo: o re-enfileirar de uma linha que nao foi escrita por ESTA
--      transacao (xmin; M2) ou que ja falhou (tentativas > 0; L2) faz UPDATE de criado_at (= clock_timestamp()) e zera
--      tentativas, e o gatilho adiado escuta INSERT e UPDATE OF criado_at (ruling (2) do controlador: desvio aceito do
--      "ON CONFLICT DO NOTHING / AFTER INSERT" do §2.6). M1: orcamento de 3 s por comando (COMMIT) em lotes de 25; o resto
--      fica na fila. L2: 5 falhas seguidas = o card para de ser tentado sozinho (marcado na fila) ate a proxima edicao.
--      M3: todo preco (artigo, substituto, OC do vinculo, aviamento, insumo) so vale se for DA LOJA do modelo.
--   7. Quem enfileira (R-CD3): gatilhos por EVENTO, AFTER ... REFERENCING ... FOR EACH STATEMENT, sem OF; o filtro OLD x NEW por
--      coluna fica na funcao (nunca custo_previsto). Excecao em modelos (tabela quente): por LINHA com WHEN (precedente
--      trg_kanban_fila_upd). Precos (artigos/aviamentos/etiquetas/variantes_etiqueta/ocs_tecido_itens) respeitam o congelado
--      (R-CD1); ficha (linhas do BOM, substitutos, vinculos de OC, M.O., custos_adicionais/origem) nao. Reverter o corte
--      (cad.enviado_corte true -> false) enfileira. Revenda/importado ficam fora (so origem 'interno' entra na fila).
--   8. O cliente deixa de mandar: trg_modelo_custo_derivado (BEFORE UPDATE em modelos) devolve as 5 colunas a OLD quando a GUC
--      nao esta 'on' e NEW.origem = 'interno' (RC4b: interno -> revenda aceita a escrita; revenda -> interno volta e enfileira).
--      INSERT fica livre (replica/criar card) e vai para a fila.
--   9. Conferido: trg_kanban_fila_upd de modelos nao lista coluna de custo; a trava da Integracao nao cobre custo;
--      fn_modelo_mo_flag_derivada/fn_modelo_markup_congela nao mexem em custo; o UPDATE das linhas enfileira o kanban
--      (inofensivo, roda no mesmo laco adiado); fn_colab_bump_modelo sobe modelos.rev UMA vez por linha regravada (R-CD5/C5).
--      Autoria no fn_audit = quem disparou a transacao (R-CD5).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- Guarda DURA: md5 de pg_get_functiondef = PRODUCAO (Passo 0-CD Rodada #1, dono, 30/set 15:42:49; igual a copia).
--   precos_tecido_congelado(uuid) aceita o texto de ANTES ou o de DEPOIS (reaplicar = no-op). As demais so sao CONFERIDAS
--   (nenhuma e reescrita): o desenho depende de quem grava o BOM/M.O./precos e de nenhum deles gravar custo em modelos.
-- Conjunto de gatilhos das 13 tabelas (md5 de nome:habilitado:md5(triggerdef) em ordem de nome, SEM os nomes novos deste
--   arquivo) = PRODUCAO (Passo 0-CD Rodada #1). Gatilho de nome novo que ja exista tem de ter a definicao de DEPOIS.
-- Objetos NOVOS: ausentes, ou com o md5 de DEPOIS, ou com o md5 NEUTRALIZADO do inverso (reaplicar depois da volta religa).
-- =====================================================================================================================
-- Travas: CREATE TABLE com FK para modelos e os CREATE TRIGGER pegam ShareRowExclusive nas 13 tabelas + na fila. Nenhum DROP
-- TRIGGER (R2: DROP TRIGGER como postgres trava ~24 tabelas de auth/storage/realtime ate o COMMIT); idempotente por
-- "cria so o que falta". lock_timeout 500ms, horario calmo, gatilhos POR ULTIMO. A C4 mede em pg_locks.
-- Volta (R2; LIFO pela ordem de APLICACAO; site volta ANTES ou junto):
--   supabase/rollback/20261019300000_custo_previsto_servidor_down_neutraliza.sql - freio de emergencia, so CREATE OR REPLACE;
--   supabase/rollback/20261019300000_custo_previsto_servidor_down.sql - DISABLE TRIGGER + neutraliza + devolve o texto de
--     precos_tecido_congelado (sem DROP; horario calmo);
--   supabase/rollback/20261019300000_custo_previsto_servidor_down_drop.sql - passo SEPARADO e opcional: os DROPs.
--   Nenhum inverso mexe em valores gravados.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '8s';
SET LOCAL transaction_timeout = '10s';

-- ACCEPTED-MD5 (lista unica usada pela guarda e pela pos-condicao)
--   papel: antes/depois = precos_tecido_congelado; dep = so conferida; novo = funcao nova (DEPOIS); neutro = texto do inverso
CREATE TEMP TABLE _cc_c1_md5 (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_c1_md5 VALUES
  ('public.precos_tecido_congelado(uuid)',                                    'd6fa813be9e183be5f4e166e4c882218', 'antes'),
  ('public.precos_tecido_congelado(uuid)',                                    'b2fff3e9047b386be863e3807bfdcfaf', 'depois'),
  ('public._custo_unitario_modelos_core(uuid[])',                             'd26c7c9afb636f6ed26e66daf76e92ae', 'dep'),
  ('public.custo_unitario_modelos(uuid[])',                                   '736770b4262c8af76b5320fefefe3a64', 'dep'),
  ('public._plan_tecido_gravar_bom_core(uuid,jsonb)',                         'e13300caf9241a4ad9e0f36e5e26528b', 'dep'),
  ('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)',  '2f2669cf7136c15038950ac1c1161637', 'dep'),
  ('public._aplicar_sim_no_modelo_core(uuid,uuid,jsonb,jsonb)',               '8cf90aad9010a88fc10cdd60d10c221c', 'dep'),
  ('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)',                    'fceac02c52bd0b29a33856dc9e0f9b11', 'dep'),
  ('public._salvar_modelo_bom_core(uuid,jsonb,jsonb,jsonb,integer)',          '213e7fb3466e55469dd51029a2c9d1dd', 'dep'),
  ('public.fn_colab_touch_rev()',                                             '292f1a1077df1e08fdca7f21eb0d856c', 'dep'),
  ('public.fn_colab_bump_modelo()',                                           '76faacb20914225261b543c3a6522c8a', 'dep'),
  ('public.fn_colab_bump_modelo_via_tecido()',                                'b259fa426ff19086c4ff5e8cf650ebcd', 'dep'),
  ('public.fn_modelo_mo_flag_derivada()',                                     '3a771d9f2f9fde46ee0c540c29b9a3b0', 'dep'),
  ('public.fn_modelo_servico_mo_rollup()',                                    'e869fdb382ab36675786c150b7cfe62a', 'dep'),
  ('public.fn_modelo_markup_congela()',                                       '0bff70c5a8911ebf0cc9dc3ce829d3ad', 'dep'),
  ('public.fn_audit()',                                                       '63e5855f24d17914aef609e35ffc499b', 'dep'),
  ('public._kanban_aplicar(uuid,uuid[],text,uuid)',                           '17c35880433e381332883c932ef6f0b0', 'dep'),
  ('public._kanban_enfileirar(uuid[])',                                       '83b3076206747102812487a0814ab809', 'dep'),
  ('public.fn_kanban_fila_por_modelo()',                                      '83b837afaaab012d00afc37cea9b3572', 'dep'),
  ('public.fn_kanban_processar_fila()',                                       'f14d567a9c20f961b8be9cc497d21238', 'dep'),
  ('public.artigos_recalc_preco()',                                           '60c1113b380b3eee4431e01a72e83dd1', 'dep'),
  ('public.variantes_etiqueta_sync_preco()',                                  'cd7b878c2e4cdc862c7b472413092b33', 'dep'),
  ('public._reverter_corte_tecido_core(uuid)',                                'aa5b0e56aea76d11a815c064e2cb1b0c', 'dep'),
  ('public._integracao_retrato_core(uuid,text[],jsonb)',                      '1cfaed33c1b166e433ca20a42e5905c5', 'dep'),
  ('public._dashboard_custos_core(date,date,text,uuid,uuid)',                 '4c30871b2f9491cfd568d6ff53cb13d8', 'dep'),
  -- funcoes NOVAS (texto deste arquivo)
  ('public._precos_tecido_congelado_core(uuid,uuid)',                         '1092be10e608976560cb855eb64d2c0f', 'novo'),
  ('public._custo_linha(numeric,numeric,numeric)',                            '461a79844e15f336824e52aca4986f42', 'novo'),
  ('public._custo_adicionais_soma(jsonb)',                                    '7d86994b9823f71362bf1901012ecbd4', 'novo'),
  ('public._custo_preco_tecido(uuid,uuid)',                                   '68ec09cdd52566ceecfcd6267d470a29', 'novo'),
  ('public._custo_preco_etiqueta(uuid,uuid,uuid)',                            '078b1e9b66300a5de9d2d993698e48bb', 'novo'),
  ('public._custo_calcular(uuid,uuid[])',                                     'f9d87d6a1f9f307a7d83cf837730566c', 'novo'),
  ('public._custo_recalcular_modelos(uuid,uuid[])',                           '89c502499b65b52964a03b0ad5856138', 'novo'),
  ('public._custo_enfileirar(uuid[],boolean)',                                'fd6a7337dd76a8a06b18d0040dd6abde', 'novo'),
  ('public.fn_custo_processar_fila()',                                        '3c8471bba6760986989ddc659dbee42f', 'novo'),
  ('public.fn_custo_fila_por_modelo()',                                       'f4ae106c44af7759106d23223e56c677', 'novo'),
  ('public.fn_custo_fila_por_modelo_tecido()',                                '627ae4106dd610c339f413914bd5ac4c', 'novo'),
  ('public.fn_custo_fila_preco()',                                            'cd405a624d82e23f0ce8120472f04471', 'novo'),
  ('public.fn_custo_fila_cad()',                                              '382a1d5e86635d0bf9d2a114ca0b0a97', 'novo'),
  ('public.fn_custo_fila_modelo()',                                           'f1c2ba13e1d00d3344d7ebd16a12fce3', 'novo'),
  ('public.fn_modelo_custo_derivado()',                                       '8a1bb256740d5aa1a4f2084adc007587', 'novo'),
  -- texto NEUTRALIZADO pelos inversos (down_neutraliza/down): reaplicar esta migration depois da volta e aceito
  ('public._custo_enfileirar(uuid[],boolean)',                                '5db568ca49628eb2ed2e2cdf3c40afd7', 'neutro'),
  ('public.fn_custo_processar_fila()',                                        'e1ce39bcdbb607fe74ce887ab8d5b15c', 'neutro'),
  ('public.fn_custo_fila_por_modelo()',                                       'e062138f732e9ddf18cfe3e382e9b9b0', 'neutro'),
  ('public.fn_custo_fila_por_modelo_tecido()',                                '15a053aef51fe9d18f8cd4ed60248dd7', 'neutro'),
  ('public.fn_custo_fila_preco()',                                            'c511be3920624e989008b9e628aaaa2e', 'neutro'),
  ('public.fn_custo_fila_cad()',                                              '96077ec208a85505521ed98e5b745acf', 'neutro'),
  ('public.fn_custo_fila_modelo()',                                           '11c173d40243a20d0f9c292a4f57e525', 'neutro'),
  ('public.fn_modelo_custo_derivado()',                                       '9181312787be6e450371e1e80b039441', 'neutro');

-- Conjunto de gatilhos por tabela (SEM os nomes novos) = PRODUCAO (Passo 0-CD Rodada #1)
CREATE TEMP TABLE _cc_c1_gatilhos (tabela text, n int, md5 text) ON COMMIT DROP;
INSERT INTO _cc_c1_gatilhos VALUES
  ('modelos',                 17, '7059d57f84a813e341c1d38da8a6d9d6'),
  ('modelo_tecidos',           4, '36fd65ba1deb849637559d8224636b1e'),
  ('modelo_tecido_variantes',  4, '1198cc20e27f531f13991a3c30655d85'),
  ('modelo_tecido_oc_links',   3, 'fd4fe45d5a79d34eb174eed3e9560742'),
  ('modelo_aviamentos',        4, '8c26a80172ba1ae6254359704c2b2607'),
  ('modelo_etiquetas',         2, '726415b09200a4c6b796f3304571cf9c'),
  ('modelo_servico_mo',        7, '79280af4db0a5f3a232f1df4ac591061'),
  ('artigos',                  4, 'dae96e2221b35458f7cbcfdc1299e9d9'),
  ('aviamentos',               3, '7322bdaf57fafc7934c18904a050afa2'),
  ('etiquetas',                1, '43b8175b402f797231cefcdd76e68289'),
  ('variantes_etiqueta',       2, '5c5c49568a9cbaaee171ee21616cf616'),
  ('ocs_tecido_itens',         1, 'e34cf2f3d144e6c3ab5883c6b1567e7b'),
  ('cad',                      8, '25cb449394372cc70b7e25a8db3eccfb');

-- Gatilhos NOVOS deste arquivo (definicao de DEPOIS = pg_get_triggerdef; conferida na guarda e na pos-condicao)
CREATE TEMP TABLE _cc_c1_gatilhos_novos (tabela text, nome text, def text, velha text, nova text) ON COMMIT DROP;
INSERT INTO _cc_c1_gatilhos_novos
SELECT x.tabela, x.nome,
       'CREATE TRIGGER ' || x.nome || ' AFTER ' || x.evento || ' ON public.' || x.tabela
       || CASE x.evento WHEN 'INSERT' THEN ' REFERENCING NEW TABLE AS novas'
                        WHEN 'UPDATE' THEN ' REFERENCING OLD TABLE AS antigas NEW TABLE AS novas'
                        ELSE ' REFERENCING OLD TABLE AS antigas' END
       || ' FOR EACH STATEMENT EXECUTE FUNCTION ' || x.fn || '()',
       CASE WHEN x.evento IN ('UPDATE', 'DELETE') THEN 'antigas' END,
       CASE WHEN x.evento IN ('INSERT', 'UPDATE') THEN 'novas' END
  FROM (VALUES
    ('modelo_tecidos',          'trg_custo_fila_ins', 'INSERT', 'fn_custo_fila_por_modelo'),
    ('modelo_tecidos',          'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_por_modelo'),
    ('modelo_tecidos',          'trg_custo_fila_del', 'DELETE', 'fn_custo_fila_por_modelo'),
    ('modelo_aviamentos',       'trg_custo_fila_ins', 'INSERT', 'fn_custo_fila_por_modelo'),
    ('modelo_aviamentos',       'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_por_modelo'),
    ('modelo_aviamentos',       'trg_custo_fila_del', 'DELETE', 'fn_custo_fila_por_modelo'),
    ('modelo_etiquetas',        'trg_custo_fila_ins', 'INSERT', 'fn_custo_fila_por_modelo'),
    ('modelo_etiquetas',        'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_por_modelo'),
    ('modelo_etiquetas',        'trg_custo_fila_del', 'DELETE', 'fn_custo_fila_por_modelo'),
    ('modelo_servico_mo',       'trg_custo_fila_ins', 'INSERT', 'fn_custo_fila_por_modelo'),
    ('modelo_servico_mo',       'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_por_modelo'),
    ('modelo_servico_mo',       'trg_custo_fila_del', 'DELETE', 'fn_custo_fila_por_modelo'),
    ('modelo_tecido_oc_links',  'trg_custo_fila_ins', 'INSERT', 'fn_custo_fila_por_modelo'),
    ('modelo_tecido_oc_links',  'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_por_modelo'),
    ('modelo_tecido_oc_links',  'trg_custo_fila_del', 'DELETE', 'fn_custo_fila_por_modelo'),
    ('modelo_tecido_variantes', 'trg_custo_fila_ins', 'INSERT', 'fn_custo_fila_por_modelo_tecido'),
    ('modelo_tecido_variantes', 'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_por_modelo_tecido'),
    ('modelo_tecido_variantes', 'trg_custo_fila_del', 'DELETE', 'fn_custo_fila_por_modelo_tecido'),
    ('artigos',                 'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_preco'),
    ('aviamentos',              'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_preco'),
    ('etiquetas',               'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_preco'),
    ('variantes_etiqueta',      'trg_custo_fila_ins', 'INSERT', 'fn_custo_fila_preco'),
    ('variantes_etiqueta',      'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_preco'),
    ('variantes_etiqueta',      'trg_custo_fila_del', 'DELETE', 'fn_custo_fila_preco'),
    ('ocs_tecido_itens',        'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_preco'),
    ('cad',                     'trg_custo_fila_upd', 'UPDATE', 'fn_custo_fila_cad')
  ) x(tabela, nome, evento, fn)
UNION ALL VALUES
  ('modelos', 'trg_custo_fila_modelo_ins',
   'CREATE TRIGGER trg_custo_fila_modelo_ins AFTER INSERT ON public.modelos FOR EACH ROW WHEN ((new.origem = ''interno''::text)) EXECUTE FUNCTION fn_custo_fila_modelo()',
   NULL, NULL),
  ('modelos', 'trg_custo_fila_modelo_upd',
   'CREATE TRIGGER trg_custo_fila_modelo_upd AFTER UPDATE ON public.modelos FOR EACH ROW WHEN (((old.custos_adicionais IS DISTINCT FROM new.custos_adicionais) OR (old.origem IS DISTINCT FROM new.origem))) EXECUTE FUNCTION fn_custo_fila_modelo()',
   NULL, NULL),
  ('modelos', 'trg_modelo_custo_derivado',
   'CREATE TRIGGER trg_modelo_custo_derivado BEFORE UPDATE ON public.modelos FOR EACH ROW WHEN (((old.custo_peca_previsto IS DISTINCT FROM new.custo_peca_previsto) OR (old.custo_tecido_total IS DISTINCT FROM new.custo_tecido_total) OR (old.custo_forro_total IS DISTINCT FROM new.custo_forro_total) OR (old.custo_entretela_total IS DISTINCT FROM new.custo_entretela_total) OR (old.custo_aviamento_total IS DISTINCT FROM new.custo_aviamento_total))) EXECUTE FUNCTION fn_modelo_custo_derivado()',
   NULL, NULL),
  ('custo_recalculo_fila', 'trg_custo_processar_fila',
   'CREATE CONSTRAINT TRIGGER trg_custo_processar_fila AFTER INSERT OR UPDATE OF criado_at ON public.custo_recalculo_fila DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_custo_processar_fila()',
   NULL, NULL);

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_def text;
BEGIN
  -- (a) funcoes existentes: texto conferido (precos_tecido_congelado: ANTES ou DEPOIS)
  FOR r IN SELECT DISTINCT assinatura FROM _cc_c1_md5 WHERE papel IN ('antes', 'depois', 'dep') LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_c1: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _cc_c1_md5 a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5
                      AND a.papel IN ('antes', 'depois', 'dep')) THEN
      RAISE EXCEPTION 'contas_certas_c1: % mudou desde o Passo 0-CD (md5 %) - outra frente mexeu; conferir', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- (b) funcoes novas: ausentes, ou com o texto deste arquivo, ou com o texto neutralizado do inverso
  FOR r IN SELECT DISTINCT assinatura FROM _cc_c1_md5 WHERE papel IN ('novo', 'neutro') LOOP
    IF to_regprocedure(r.assinatura) IS NOT NULL THEN
      v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
      IF NOT EXISTS (SELECT 1 FROM _cc_c1_md5 a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5
                        AND a.papel IN ('novo', 'neutro')) THEN
        RAISE EXCEPTION 'contas_certas_c1: % ja existe com outro texto (md5 %)', r.assinatura, v_md5 USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
  -- (c) conjunto de gatilhos das 13 tabelas, sem os nomes novos
  FOR r IN
    SELECT g.tabela, g.n, g.md5 AS esperado, count(t.oid) AS n_atual,
           md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), '')) AS atual
      FROM _cc_c1_gatilhos g
      LEFT JOIN pg_trigger t ON t.tgrelid = to_regclass('public.' || g.tabela) AND NOT t.tgisinternal
                            AND t.tgname NOT LIKE 'trg\_custo\_%' AND t.tgname <> 'trg_modelo_custo_derivado'
     GROUP BY g.tabela, g.n, g.md5
  LOOP
    IF r.atual IS DISTINCT FROM r.esperado THEN
      RAISE EXCEPTION 'contas_certas_c1: gatilhos de % mudaram desde o Passo 0-CD (% gatilho(s), md5 %) - conferir', r.tabela, r.n_atual, r.atual
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- (d) gatilho de nome novo que ja existe: so com a definicao de DEPOIS (ligado ou desligado pelo inverso)
  FOR r IN SELECT t.tgname, c.relname::text AS tabela, pg_get_triggerdef(t.oid) AS def
             FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
            WHERE NOT t.tgisinternal AND c.relnamespace = 'public'::regnamespace
              AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado') LOOP
    v_def := NULL;
    SELECT n.def INTO v_def FROM _cc_c1_gatilhos_novos n WHERE n.nome = r.tgname AND n.tabela = r.tabela;
    IF v_def IS NULL OR v_def IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION 'contas_certas_c1: gatilho %.% existe com outra definicao', r.tabela, r.tgname USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- (e) a fila, se existe, tem o formato deste arquivo
  IF to_regclass('public.custo_recalculo_fila') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ',' ORDER BY a.attnum)
            FROM pg_attribute a WHERE a.attrelid = to_regclass('public.custo_recalculo_fila') AND a.attnum > 0 AND NOT a.attisdropped)
         IS DISTINCT FROM 'modelo_id:uuid:true,tenant_id:uuid:true,criado_at:timestamp with time zone:true,tentativas:integer:true' THEN
    RAISE EXCEPTION 'contas_certas_c1: custo_recalculo_fila ja existe com outro formato' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

-- ─────────────────────────────── 1. RC1: preco congelado pela OC com a loja explicita ───────────────────────────────
CREATE OR REPLACE FUNCTION public._precos_tecido_congelado_core(_modelo_id uuid, _tenant uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] RC1: o corpo de precos_tecido_congelado com a LOJA por parametro (o servidor recalcula sem JWT). M3: a
  -- OC do item e o artigo da variante do vinculo tambem tem de ser DA LOJA - referencia a outra loja nao congela nada.
  SELECT COALESCE(jsonb_object_agg(s.k, s.ppm), '{}'::jsonb)
  FROM (
    SELECT l.tipo || '|' || l.numero AS k,
           MAX(CASE WHEN a.unidade_medida = 'kg' AND COALESCE(a.rendimento,0) > 0
                    THEN oti.preco / a.rendimento ELSE oti.preco END) AS ppm
    FROM public.modelo_tecido_oc_links l
    JOIN public.ocs_tecido_itens oti ON oti.id = l.oc_tecido_item_id
    JOIN public.ocs_tecido oc ON oc.id = oti.oc_tecido_id AND oc.tenant_id = _tenant
    JOIN public.variantes_tecido vt ON vt.id = l.variante_tecido_id
    JOIN public.artigos a ON a.id = vt.artigo_id AND a.tenant_id = _tenant
    WHERE l.modelo_id = _modelo_id
      AND l.tenant_id = _tenant
      AND oti.preco IS NOT NULL AND COALESCE(oti.cancelado,false) = false
    GROUP BY l.tipo, l.numero
  ) s;
$function$;

CREATE OR REPLACE FUNCTION public.precos_tecido_congelado(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] RC1: a conta mora em _precos_tecido_congelado_core; aqui a loja vem do JWT, como sempre.
  SELECT public._precos_tecido_congelado_core(_modelo_id, public.get_user_tenant_id());
$function$;

-- ─────────────────────────────── 2. funcoes puras (anti-drift tests/fixtures/custo-bom-casos.ts) ───────────────────────────────
CREATE OR REPLACE FUNCTION public._custo_linha(_preco numeric, _consumo numeric, _perda numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] = recomputeBlock/recomputeAviamento/recomputeEtiqueta: preco x consumo x (1 + perda/100), 2 casas.
  -- Tolerancia R-CD4: o SQL arredonda meio centavo para cima (1,005 -> 1,01); o TS em ponto flutuante pode dar 1,00.
  SELECT round(coalesce(_preco, 0) * coalesce(_consumo, 0) * (1 + coalesce(_perda, 0) / 100.0), 2);
$function$;

CREATE OR REPLACE FUNCTION public._custo_adicionais_soma(_custos jsonb)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] R-CD6 (= somaCustosAdicionais nos casos reais): valor numero -> o valor; string numerica (trim,
  -- aceita expoente) -> o valor; qualquer outra coisa, ou custos_adicionais que nao e array -> 0.
  SELECT coalesce((SELECT sum(CASE
            WHEN jsonb_typeof(c -> 'valor') = 'number' THEN (c ->> 'valor')::numeric
            WHEN jsonb_typeof(c -> 'valor') = 'string'
                 AND btrim(c ->> 'valor') ~ '^[+-]?([0-9]+[.]?[0-9]*|[.][0-9]+)([eE][+-]?[0-9]{1,3})?$'
              THEN btrim(c ->> 'valor')::numeric
            ELSE 0 END)
       FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_custos) = 'array' THEN _custos ELSE '[]'::jsonb END) c), 0);
$function$;

-- ─────────────────────────────── 3. preco por linha (loja explicita) ───────────────────────────────
CREATE OR REPLACE FUNCTION public._custo_preco_tecido(_modelo_tecido_id uuid, _tenant uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] preco por metro da linha: congelado pela OC vinculada ao (tipo, numero) (RC1, loja do modelo), senao o
  -- MAIOR coalesce(preco_por_metro, preco, 0) dos artigos das variantes (substitutos), senao o do artigo da linha, senao 0.
  -- M3: so artigo DA LOJA (_tenant) - linha apontando para artigo de outra loja nunca vaza o preco dela.
  SELECT coalesce(
           (public._precos_tecido_congelado_core(mt.modelo_id, _tenant) ->> (mt.tipo || '|' || mt.numero))::numeric,
           (SELECT max(coalesce(a.preco_por_metro, a.preco, 0))
              FROM public.modelo_tecido_variantes mtv
              JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
              JOIN public.artigos a ON a.id = vt.artigo_id AND a.tenant_id = _tenant
             WHERE mtv.modelo_tecido_id = mt.id),
           (SELECT coalesce(a.preco_por_metro, a.preco, 0) FROM public.artigos a WHERE a.id = mt.artigo_id AND a.tenant_id = _tenant),
           0)
    FROM public.modelo_tecidos mt
   WHERE mt.id = _modelo_tecido_id;
$function$;

CREATE OR REPLACE FUNCTION public._custo_preco_etiqueta(_etiqueta_id uuid, _cor_id uuid, _tenant uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] = precoEtiquetaCor: MAX das variantes da cor (IS NOT DISTINCT FROM) contando so preco > 0 (o TS
  -- comeca o MAX em 0 - preco negativo nunca vence; G-scripts L4), senao o preco base da etiqueta, senao 0. M3: so etiqueta
  -- DA LOJA (_tenant; as variantes pela etiqueta) - insumo de outra loja = 0.
  SELECT coalesce(
           (SELECT max(ve.preco) FROM public.variantes_etiqueta ve
              JOIN public.etiquetas et ON et.id = ve.etiqueta_id AND et.tenant_id = _tenant
             WHERE ve.etiqueta_id = _etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM _cor_id AND ve.preco > 0),
           (SELECT et.preco FROM public.etiquetas et WHERE et.id = _etiqueta_id AND et.tenant_id = _tenant),
           0);
$function$;

-- ─────────────────────────────── 4. calculo em conjunto ───────────────────────────────
CREATE OR REPLACE FUNCTION public._custo_calcular(_tenant uuid, _ids uuid[])
 RETURNS TABLE(tabela text, id uuid, modelo_id uuid, tipo text, custo numeric, tecido numeric, forro numeric,
               entretela numeric, aviamento numeric, etiqueta numeric, mao_obra numeric, adicionais numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [custo-servidor C1] custo previsto de cada modelo INTERNO da loja (_ids NULL = todos): uma linha por linha do BOM
  -- (tabela, id, modelo, tipo, custo) + uma linha 'modelos' por card (id = modelo) com os totais e custo = peca, somada na
  -- ordem de pecaCom: tecido + forro + entretela + aviamento + etiqueta + M.O. + adicionais. Sem arredondar a peca (o
  -- aplicador grava round(peca, 2) em numeric(10,2)). M3: todo preco vem so de cadastro/OC DA LOJA (_tenant).
  WITH mo_ AS (
    SELECT m.id AS mid, m.custos_adicionais AS ca
      FROM public.modelos m
     WHERE m.tenant_id = _tenant AND m.origem = 'interno' AND (_ids IS NULL OR m.id = ANY (_ids))
  ),
  li AS (
    SELECT 'modelo_tecidos'::text AS tb, mt.id AS lid, mt.modelo_id AS lmid, mt.tipo::text AS tp,
           public._custo_linha(public._custo_preco_tecido(mt.id, _tenant), mt.consumo, mt.loss_percent) AS c
      FROM public.modelo_tecidos mt JOIN mo_ ON mo_.mid = mt.modelo_id
    UNION ALL
    SELECT 'modelo_aviamentos'::text, ma.id, ma.modelo_id, 'aviamento'::text,
           public._custo_linha(coalesce((SELECT av.preco FROM public.aviamentos av WHERE av.id = ma.aviamento_id AND av.tenant_id = _tenant), 0),
                               ma.consumo, ma.loss_percent)
      FROM public.modelo_aviamentos ma JOIN mo_ ON mo_.mid = ma.modelo_id
    UNION ALL
    SELECT 'modelo_etiquetas'::text, me.id, me.modelo_id, 'etiqueta'::text,
           public._custo_linha(public._custo_preco_etiqueta(me.etiqueta_id, me.cor_id, _tenant), me.consumo, me.loss_percent)
      FROM public.modelo_etiquetas me JOIN mo_ ON mo_.mid = me.modelo_id
  ),
  tot AS (
    SELECT mo_.mid,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'tecido'), 0) AS t_tecido,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'forro'), 0) AS t_forro,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'entretela'), 0) AS t_entretela,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'aviamento'), 0) AS t_aviamento,
           coalesce(sum(li.c) FILTER (WHERE li.tp = 'etiqueta'), 0) AS t_etiqueta,
           coalesce((SELECT sum(s.valor) FROM public.modelo_servico_mo s WHERE s.modelo_id = mo_.mid), 0) AS t_mo,
           public._custo_adicionais_soma(mo_.ca) AS t_adic
      FROM mo_ LEFT JOIN li ON li.lmid = mo_.mid
     GROUP BY mo_.mid, mo_.ca
  )
  SELECT li.tb, li.lid, li.lmid, li.tp, li.c,
         NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric, NULL::numeric
    FROM li
  UNION ALL
  SELECT 'modelos'::text, t.mid, t.mid, NULL::text,
         t.t_tecido + t.t_forro + t.t_entretela + t.t_aviamento + t.t_etiqueta + t.t_mo + t.t_adic,
         t.t_tecido, t.t_forro, t.t_entretela, t.t_aviamento, t.t_etiqueta, t.t_mo, t.t_adic
    FROM tot t;
$function$;

-- ─────────────────────────────── 5. aplicador ───────────────────────────────
CREATE OR REPLACE FUNCTION public._custo_recalcular_modelos(_tenant uuid, _ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] grava o custo previsto derivado dos modelos INTERNOS da loja em _ids (linhas do BOM + as 5 colunas de
-- modelos), so onde muda (IS DISTINCT FROM: modelo sem mudanca nao sobe o rev). Devolve quantos modelos mudaram.
-- R1: trava os modelos em ORDER BY id antes de escrever (dois recalculos do mesmo card nunca se cruzam em ordem diferente).
-- RC4a: liga app.custo_sistema='on' (os gatilhos da fila e o trg_modelo_custo_derivado deixam passar) e RESTAURA o valor
-- anterior no fim; se algo falhar, o rollback do sub-bloco de quem chamou desfaz a GUC junto.
DECLARE
  v_ant text := coalesce(current_setting('app.custo_sistema', true), '');
  v_ids uuid[];
  v_n integer := 0;
BEGIN
  IF _tenant IS NULL OR _ids IS NULL OR cardinality(_ids) = 0 THEN
    RETURN 0;
  END IF;
  SELECT array_agg(x.id ORDER BY x.id) INTO v_ids
    FROM (SELECT m.id FROM public.modelos m
           WHERE m.id = ANY (_ids) AND m.tenant_id = _tenant AND m.origem = 'interno'
           ORDER BY m.id
             FOR NO KEY UPDATE) x;
  IF v_ids IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.custo_sistema', 'on', true);
  WITH c AS MATERIALIZED (
    SELECT * FROM public._custo_calcular(_tenant, v_ids)
  ), ut AS (
    UPDATE public.modelo_tecidos t SET custo_previsto = c.custo
      FROM c WHERE c.tabela = 'modelo_tecidos' AND t.id = c.id AND t.custo_previsto IS DISTINCT FROM c.custo
    RETURNING t.id
  ), ua AS (
    UPDATE public.modelo_aviamentos t SET custo_previsto = c.custo
      FROM c WHERE c.tabela = 'modelo_aviamentos' AND t.id = c.id AND t.custo_previsto IS DISTINCT FROM c.custo
    RETURNING t.id
  ), ue AS (
    UPDATE public.modelo_etiquetas t SET custo_previsto = c.custo
      FROM c WHERE c.tabela = 'modelo_etiquetas' AND t.id = c.id AND t.custo_previsto IS DISTINCT FROM c.custo
    RETURNING t.id
  ), um AS (
    UPDATE public.modelos m
       SET custo_peca_previsto = round(c.custo, 2),
           custo_tecido_total = c.tecido,
           custo_forro_total = c.forro,
           custo_entretela_total = c.entretela,
           custo_aviamento_total = c.aviamento
      FROM c
     WHERE c.tabela = 'modelos' AND m.id = c.id
       AND (m.custo_peca_previsto, m.custo_tecido_total, m.custo_forro_total, m.custo_entretela_total, m.custo_aviamento_total)
           IS DISTINCT FROM (round(c.custo, 2), c.tecido, c.forro, c.entretela, c.aviamento)
    RETURNING m.id
  )
  SELECT count(*) INTO v_n FROM um;
  PERFORM set_config('app.custo_sistema', v_ant, true);
  RETURN v_n;
END;
$function$;

-- ─────────────────────────────── 6. fila adiada ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.custo_recalculo_fila (
  modelo_id uuid        NOT NULL PRIMARY KEY REFERENCES public.modelos(id) ON DELETE CASCADE,
  tenant_id uuid        NOT NULL,
  criado_at timestamptz NOT NULL DEFAULT now(),
  tentativas integer    NOT NULL DEFAULT 0
);
COMMENT ON TABLE public.custo_recalculo_fila IS
  'Modelos INTERNOS com custo previsto a recalcular no COMMIT (contas certas C1). So o gatilho adiado trg_custo_processar_fila le; RLS sem policy.';
CREATE INDEX IF NOT EXISTS custo_recalculo_fila_tenant_idx ON public.custo_recalculo_fila (tenant_id);
ALTER TABLE public.custo_recalculo_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.custo_recalculo_fila FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._custo_enfileirar(_ids uuid[], _respeitar_congelado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] poe na fila os modelos INTERNOS de _ids (JOIN em modelos: id que nao existe mais - exclusao em cascata -
-- nunca viola a FK). Com a GUC app.custo_sistema='on' (o proprio aplicador escrevendo) nao faz nada. _respeitar_congelado
-- (gatilhos de PRECO, R-CD1/P-169 A): pula o card ja enviado ao corte. Linha que SOBROU de transacao anterior (recalculo que
-- falhou, R1) e REARMADA (criado_at = clock_timestamp(), tentativas = 0 -> o gatilho adiado dispara de novo): M2 - o criterio e
-- "a linha nao foi escrita por ESTA transacao" (xmin), nao o horario de inicio (now() de uma transacao que comecou antes da
-- falha seria menor que o criado_at dela); L2 - linha com tentativas > 0 (falhou antes) tambem e rearmada: uma edicao de
-- verdade zera o contador. Linha ja escrita por esta transacao e sem falha: nada (sem disparo repetido).
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN
    RETURN;
  END IF;
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN;
  END IF;
  INSERT INTO public.custo_recalculo_fila AS f (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
   WHERE m.id = ANY (_ids)
     AND m.origem = 'interno'
     AND m.tenant_id IS NOT NULL
     AND (NOT coalesce(_respeitar_congelado, false)
          OR NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte))
   ORDER BY m.id
  ON CONFLICT (modelo_id) DO UPDATE SET criado_at = clock_timestamp(), tentativas = 0
   WHERE f.tentativas > 0 OR f.xmin <> pg_current_xact_id()::xid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_processar_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
-- [custo-servidor C1] roda no COMMIT (CONSTRAINT TRIGGER adiado). O 1o disparo da loja leva a fila dela; os demais acham a
-- propria linha ja processada e saem. Erro nunca derruba o COMMIT de quem disparou:
--   R1 - nunca perde recalculo: o DELETE ... RETURNING fica DENTRO do bloco protegido (erro = a fila volta); lote falhou ->
--     card a card, cada um no seu sub-bloco; o card que falhar FICA na fila (WARNING ASCII) e e refeito no proximo COMMIT da loja.
--   M1 - ORCAMENTO DE TEMPO: EXCEPTION WHEN OTHERS nao pega 57014 (statement_timeout do authenticated = 8 s, que conta o
--     COMMIT inteiro; um SET statement_timeout na funcao NAO desliga o relogio do comando em curso - medido). Entao a fila e
--     feita em lotes de 25 cards e PARA quando o comando (COMMIT / SET CONSTRAINTS) ja gastou 3 s - o prazo e um so para
--     todos os disparos do mesmo comando (GUC app.custo_fila_prazo marcada com statement_timestamp()); o que sobrar fica na
--     fila (WARNING ASCII) para o proximo COMMIT da loja ou a proxima edicao do card. Pior caso ~ 3 s + 1 espera de trava (2 s).
--   L2 - card que falha 5 vezes seguidas deixa de ser tentado sozinho (tentativas = 5, fica na fila, WARNING ASCII); a
--     proxima edicao de verdade do card zera o contador (_custo_enfileirar). O UPDATE de tentativas nao redispara o
--     gatilho (ele so escuta INSERT e UPDATE OF criado_at).
DECLARE
  c_orcamento CONSTANT interval := interval '3 seconds';
  c_lote CONSTANT integer := 25;
  c_max CONSTANT integer := 5;
  v_marca text;
  v_prazo timestamptz;
  v_ids uuid[];
  v_lote uuid[];
  v_feitos uuid[];
  v_id uuid;
  v_n integer;
  i integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.custo_recalculo_fila f WHERE f.modelo_id = NEW.modelo_id AND f.tentativas < c_max) THEN
    RETURN NULL;
  END IF;
  v_marca := coalesce(current_setting('app.custo_fila_prazo', true), '');
  IF split_part(v_marca, '|', 1) = statement_timestamp()::text THEN
    v_prazo := split_part(v_marca, '|', 2)::timestamptz;
    IF clock_timestamp() >= v_prazo THEN
      RETURN NULL;  -- este comando ja gastou o orcamento (o aviso saiu no disparo que parou)
    END IF;
  ELSE
    v_prazo := clock_timestamp() + c_orcamento;
    PERFORM set_config('app.custo_fila_prazo', statement_timestamp()::text || '|' || v_prazo::text, true);
  END IF;
  SELECT array_agg(f.modelo_id ORDER BY f.modelo_id) INTO v_ids
    FROM public.custo_recalculo_fila f
   WHERE f.tenant_id = NEW.tenant_id AND f.tentativas < c_max;
  FOR i IN 1 .. coalesce(cardinality(v_ids), 0) BY c_lote LOOP
    IF clock_timestamp() >= v_prazo THEN
      RAISE WARNING 'custo_previsto: orcamento de tempo do COMMIT esgotado (loja %): % card(s) ficam na fila para o proximo COMMIT',
        NEW.tenant_id, cardinality(v_ids) - i + 1;
      RETURN NULL;
    END IF;
    v_lote := v_ids[i : i + c_lote - 1];
    v_feitos := NULL;
    BEGIN
      WITH alvo AS (
        SELECT f.modelo_id FROM public.custo_recalculo_fila f
         WHERE f.modelo_id = ANY (v_lote) AND f.tentativas < c_max ORDER BY f.modelo_id FOR UPDATE
      ), d AS (
        DELETE FROM public.custo_recalculo_fila f USING alvo WHERE f.modelo_id = alvo.modelo_id RETURNING f.modelo_id
      )
      SELECT array_agg(d.modelo_id ORDER BY d.modelo_id) INTO v_feitos FROM d;
      IF v_feitos IS NOT NULL THEN
        PERFORM public._custo_recalcular_modelos(NEW.tenant_id, v_feitos);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'custo_previsto: recalculo do lote falhou (loja %, % card(s)): % [%] - tentando card a card',
        NEW.tenant_id, cardinality(v_lote), SQLERRM, SQLSTATE;
      FOREACH v_id IN ARRAY v_lote LOOP
        IF clock_timestamp() >= v_prazo THEN
          RAISE WARNING 'custo_previsto: orcamento de tempo do COMMIT esgotado (loja %) no card a card - o resto fica na fila para o proximo COMMIT',
            NEW.tenant_id;
          RETURN NULL;
        END IF;
        BEGIN
          DELETE FROM public.custo_recalculo_fila f WHERE f.modelo_id = v_id AND f.tentativas < c_max;
          IF FOUND THEN
            PERFORM public._custo_recalcular_modelos(NEW.tenant_id, ARRAY[v_id]);
          END IF;
        EXCEPTION WHEN OTHERS THEN
          UPDATE public.custo_recalculo_fila f SET tentativas = f.tentativas + 1 WHERE f.modelo_id = v_id
          RETURNING f.tentativas INTO v_n;
          IF coalesce(v_n, 0) >= c_max THEN
            RAISE WARNING 'custo_previsto: card % desistiu apos % tentativas (loja %): % [%] - fica na fila marcado; a proxima edicao do card tenta de novo',
              v_id, c_max, NEW.tenant_id, SQLERRM, SQLSTATE;
          ELSE
            RAISE WARNING 'custo_previsto: card % continua na fila (loja %, tentativa % de %): % [%]',
              v_id, NEW.tenant_id, coalesce(v_n, 0), c_max, SQLERRM, SQLSTATE;
          END IF;
        END;
      END LOOP;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- ─────────────────────────────── 7. quem enfileira ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_custo_fila_por_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] FICHA do card (nao respeita o congelado, R-CD1): modelo_tecidos, modelo_aviamentos, modelo_etiquetas,
-- modelo_servico_mo e modelo_tecido_oc_links; gatilhos de STATEMENT com tabelas de transicao (novas/antigas), sem OF. No
-- UPDATE so enfileira quando muda coluna que entra na conta (OLD x NEW casados por id; nunca custo_previsto, R-CD3).
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.modelo_id) INTO v_ids FROM novas n WHERE n.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.modelo_id) INTO v_ids FROM antigas o WHERE o.modelo_id IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'modelo_tecidos' THEN
    SELECT array_agg(DISTINCT x.mid) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      CROSS JOIN LATERAL unnest(ARRAY[o.modelo_id, n.modelo_id]) AS x(mid)
     WHERE x.mid IS NOT NULL
       AND (o.artigo_id, o.tipo, o.numero, o.consumo, o.loss_percent, o.modelo_id)
           IS DISTINCT FROM (n.artigo_id, n.tipo, n.numero, n.consumo, n.loss_percent, n.modelo_id);
  ELSIF TG_TABLE_NAME = 'modelo_aviamentos' THEN
    SELECT array_agg(DISTINCT x.mid) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      CROSS JOIN LATERAL unnest(ARRAY[o.modelo_id, n.modelo_id]) AS x(mid)
     WHERE x.mid IS NOT NULL
       AND (o.aviamento_id, o.consumo, o.loss_percent, o.modelo_id)
           IS DISTINCT FROM (n.aviamento_id, n.consumo, n.loss_percent, n.modelo_id);
  ELSIF TG_TABLE_NAME = 'modelo_etiquetas' THEN
    SELECT array_agg(DISTINCT x.mid) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      CROSS JOIN LATERAL unnest(ARRAY[o.modelo_id, n.modelo_id]) AS x(mid)
     WHERE x.mid IS NOT NULL
       AND (o.etiqueta_id, o.cor_id, o.consumo, o.loss_percent, o.modelo_id)
           IS DISTINCT FROM (n.etiqueta_id, n.cor_id, n.consumo, n.loss_percent, n.modelo_id);
  ELSIF TG_TABLE_NAME = 'modelo_servico_mo' THEN
    SELECT array_agg(DISTINCT x.mid) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      CROSS JOIN LATERAL unnest(ARRAY[o.modelo_id, n.modelo_id]) AS x(mid)
     WHERE x.mid IS NOT NULL
       AND (o.valor, o.modelo_id) IS DISTINCT FROM (n.valor, n.modelo_id);
  ELSIF TG_TABLE_NAME = 'modelo_tecido_oc_links' THEN
    SELECT array_agg(DISTINCT x.mid) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      CROSS JOIN LATERAL unnest(ARRAY[o.modelo_id, n.modelo_id]) AS x(mid)
     WHERE x.mid IS NOT NULL
       AND (o.tipo, o.numero, o.variante_tecido_id, o.oc_tecido_item_id, o.modelo_id)
           IS DISTINCT FROM (n.tipo, n.numero, n.variante_tecido_id, n.oc_tecido_item_id, n.modelo_id);
  END IF;
  PERFORM public._custo_enfileirar(v_ids, false);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_por_modelo_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] substitutos (modelo_tecido_variantes) mudam o MAX do preco da linha: enfileira o modelo da linha. No
-- UPDATE so quando muda variante_tecido_id/modelo_tecido_id. Ficha: nao respeita o congelado (R-CD1).
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM novas n JOIN public.modelo_tecidos mt ON mt.id = n.modelo_tecido_id WHERE mt.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM antigas o JOIN public.modelo_tecidos mt ON mt.id = o.modelo_tecido_id WHERE mt.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      CROSS JOIN LATERAL unnest(ARRAY[o.modelo_tecido_id, n.modelo_tecido_id]) AS x(mtid)
      JOIN public.modelo_tecidos mt ON mt.id = x.mtid
     WHERE mt.modelo_id IS NOT NULL
       AND (o.variante_tecido_id, o.modelo_tecido_id) IS DISTINCT FROM (n.variante_tecido_id, n.modelo_tecido_id);
  END IF;
  PERFORM public._custo_enfileirar(v_ids, false);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_preco()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] PRECO de cadastro (artigos, aviamentos, etiquetas, variantes_etiqueta, ocs_tecido_itens): enfileira os
-- internos DA MESMA LOJA do item que o usam, PULANDO o card ja enviado ao corte (R-CD1/P-169 A: o previsto congela no
-- envio). So quando muda coluna de preco (OLD x NEW por id).
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'artigos' THEN
    WITH mud AS (
      SELECT n.id, n.tenant_id FROM novas n JOIN antigas o ON o.id = n.id
       WHERE (o.preco, o.preco_por_metro, o.rendimento, o.unidade_medida)
             IS DISTINCT FROM (n.preco, n.preco_por_metro, n.rendimento, n.unidade_medida)
    ), u AS (
      SELECT mt.modelo_id, mud.tenant_id FROM mud JOIN public.modelo_tecidos mt ON mt.artigo_id = mud.id
      UNION
      SELECT mt.modelo_id, mud.tenant_id FROM mud
        JOIN public.variantes_tecido vt ON vt.artigo_id = mud.id
        JOIN public.modelo_tecido_variantes mtv ON mtv.variante_tecido_id = vt.id
        JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
      UNION
      SELECT l.modelo_id, mud.tenant_id FROM mud
        JOIN public.variantes_tecido vt ON vt.artigo_id = mud.id
        JOIN public.modelo_tecido_oc_links l ON l.variante_tecido_id = vt.id
    )
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM u JOIN public.modelos m ON m.id = u.modelo_id AND m.tenant_id = u.tenant_id;
  ELSIF TG_TABLE_NAME = 'aviamentos' THEN
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      JOIN public.modelo_aviamentos ma ON ma.aviamento_id = n.id
      JOIN public.modelos m ON m.id = ma.modelo_id AND m.tenant_id = n.tenant_id
     WHERE o.preco IS DISTINCT FROM n.preco;
  ELSIF TG_TABLE_NAME = 'etiquetas' THEN
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      JOIN public.modelo_etiquetas me ON me.etiqueta_id = n.id
      JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = n.tenant_id
     WHERE o.preco IS DISTINCT FROM n.preco;
  ELSIF TG_TABLE_NAME = 'variantes_etiqueta' THEN
    IF TG_OP = 'INSERT' THEN
      SELECT array_agg(DISTINCT m.id) INTO v_ids
        FROM novas n
        JOIN public.modelo_etiquetas me ON me.etiqueta_id = n.etiqueta_id
        JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = n.tenant_id;
    ELSIF TG_OP = 'DELETE' THEN
      SELECT array_agg(DISTINCT m.id) INTO v_ids
        FROM antigas o
        JOIN public.modelo_etiquetas me ON me.etiqueta_id = o.etiqueta_id
        JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = o.tenant_id;
    ELSE
      SELECT array_agg(DISTINCT m.id) INTO v_ids
        FROM novas n JOIN antigas o ON o.id = n.id
        CROSS JOIN LATERAL (VALUES (o.etiqueta_id, o.tenant_id), (n.etiqueta_id, n.tenant_id)) AS x(etq, tid)
        JOIN public.modelo_etiquetas me ON me.etiqueta_id = x.etq
        JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = x.tid
       WHERE (o.preco, o.cor_id, o.etiqueta_id) IS DISTINCT FROM (n.preco, n.cor_id, n.etiqueta_id);
    END IF;
  ELSIF TG_TABLE_NAME = 'ocs_tecido_itens' THEN
    SELECT array_agg(DISTINCT m.id) INTO v_ids
      FROM novas n JOIN antigas o ON o.id = n.id
      JOIN public.modelo_tecido_oc_links l ON l.oc_tecido_item_id = n.id
      JOIN public.modelos m ON m.id = l.modelo_id AND m.tenant_id = l.tenant_id
     WHERE (o.preco, o.cancelado) IS DISTINCT FROM (n.preco, n.cancelado);
  END IF;
  PERFORM public._custo_enfileirar(v_ids, true);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] R-CD1: reverter o corte (cad.enviado_corte true -> false) DESCONGELA - enfileira o modelo para o custo
-- previsto alcancar o cadastro de hoje.
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(DISTINCT n.modelo_id) INTO v_ids
    FROM novas n JOIN antigas o ON o.id = n.id
   WHERE n.modelo_id IS NOT NULL AND coalesce(o.enviado_corte, false) AND NOT coalesce(n.enviado_corte, false);
  PERFORM public._custo_enfileirar(v_ids, false);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] modelos (tabela quente, gatilho por LINHA com WHEN): INSERT interno (replica, criar card, duplicar) e
-- UPDATE de custos_adicionais ou de origem (RC4b: revenda -> interno recalcula).
BEGIN
  PERFORM public._custo_enfileirar(ARRAY[NEW.id], false);
  RETURN NULL;
END;
$function$;

-- ─────────────────────────────── 8. o cliente deixa de mandar ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_modelo_custo_derivado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [custo-servidor C1] custo previsto do INTERNO e so do servidor: sem a GUC app.custo_sistema='on', as 5 colunas voltam ao
-- valor de antes, sem erro (mesmo desenho do fn_modelo_mo_flag_derivada). RC4b: com NEW.origem <> 'interno' (interno ->
-- revenda/importado) a escrita do cliente vale; revenda -> interno volta e o trg_custo_fila_modelo_upd enfileira.
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.origem = 'interno' THEN
    NEW.custo_peca_previsto := OLD.custo_peca_previsto;
    NEW.custo_tecido_total := OLD.custo_tecido_total;
    NEW.custo_forro_total := OLD.custo_forro_total;
    NEW.custo_entretela_total := OLD.custo_entretela_total;
    NEW.custo_aviamento_total := OLD.custo_aviamento_total;
  END IF;
  RETURN NEW;
END;
$function$;

-- #9: todo "_" novo e toda funcao de gatilho sem EXECUTE para PUBLIC/anon/authenticated (precos_tecido_congelado mantem o ACL)
REVOKE EXECUTE ON FUNCTION public._precos_tecido_congelado_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._custo_linha(numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._custo_adicionais_soma(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._custo_preco_tecido(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._custo_preco_etiqueta(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._custo_calcular(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._custo_recalcular_modelos(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._custo_enfileirar(uuid[], boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_custo_processar_fila() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_por_modelo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_por_modelo_tecido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_preco() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_cad() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_modelo() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_custo_derivado() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────── 9. gatilhos POR ULTIMO ───────────────────────────────
-- Idempotente SEM "DROP TRIGGER" (R2): cria so o que falta; o que existe (desligado pelo inverso) e religado. A definicao de
-- quem ja existia foi conferida na guarda (d).
DO $gatilhos$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT x.tabela, x.nome, x.evento, x.transicao, x.fn
      FROM (VALUES
        ('modelo_tecidos',          'trg_custo_fila_ins', 'INSERT', 'NEW TABLE AS novas',                    'fn_custo_fila_por_modelo'),
        ('modelo_tecidos',          'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_por_modelo'),
        ('modelo_tecidos',          'trg_custo_fila_del', 'DELETE', 'OLD TABLE AS antigas',                  'fn_custo_fila_por_modelo'),
        ('modelo_aviamentos',       'trg_custo_fila_ins', 'INSERT', 'NEW TABLE AS novas',                    'fn_custo_fila_por_modelo'),
        ('modelo_aviamentos',       'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_por_modelo'),
        ('modelo_aviamentos',       'trg_custo_fila_del', 'DELETE', 'OLD TABLE AS antigas',                  'fn_custo_fila_por_modelo'),
        ('modelo_etiquetas',        'trg_custo_fila_ins', 'INSERT', 'NEW TABLE AS novas',                    'fn_custo_fila_por_modelo'),
        ('modelo_etiquetas',        'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_por_modelo'),
        ('modelo_etiquetas',        'trg_custo_fila_del', 'DELETE', 'OLD TABLE AS antigas',                  'fn_custo_fila_por_modelo'),
        ('modelo_servico_mo',       'trg_custo_fila_ins', 'INSERT', 'NEW TABLE AS novas',                    'fn_custo_fila_por_modelo'),
        ('modelo_servico_mo',       'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_por_modelo'),
        ('modelo_servico_mo',       'trg_custo_fila_del', 'DELETE', 'OLD TABLE AS antigas',                  'fn_custo_fila_por_modelo'),
        ('modelo_tecido_oc_links',  'trg_custo_fila_ins', 'INSERT', 'NEW TABLE AS novas',                    'fn_custo_fila_por_modelo'),
        ('modelo_tecido_oc_links',  'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_por_modelo'),
        ('modelo_tecido_oc_links',  'trg_custo_fila_del', 'DELETE', 'OLD TABLE AS antigas',                  'fn_custo_fila_por_modelo'),
        ('modelo_tecido_variantes', 'trg_custo_fila_ins', 'INSERT', 'NEW TABLE AS novas',                    'fn_custo_fila_por_modelo_tecido'),
        ('modelo_tecido_variantes', 'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_por_modelo_tecido'),
        ('modelo_tecido_variantes', 'trg_custo_fila_del', 'DELETE', 'OLD TABLE AS antigas',                  'fn_custo_fila_por_modelo_tecido'),
        ('artigos',                 'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_preco'),
        ('aviamentos',              'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_preco'),
        ('etiquetas',               'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_preco'),
        ('variantes_etiqueta',      'trg_custo_fila_ins', 'INSERT', 'NEW TABLE AS novas',                    'fn_custo_fila_preco'),
        ('variantes_etiqueta',      'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_preco'),
        ('variantes_etiqueta',      'trg_custo_fila_del', 'DELETE', 'OLD TABLE AS antigas',                  'fn_custo_fila_preco'),
        ('ocs_tecido_itens',        'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_preco'),
        ('cad',                     'trg_custo_fila_upd', 'UPDATE', 'OLD TABLE AS antigas NEW TABLE AS novas', 'fn_custo_fila_cad')
      ) x(tabela, nome, evento, transicao, fn)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = r.nome AND t.tgrelid = to_regclass('public.' || r.tabela)) THEN
      EXECUTE format('CREATE TRIGGER %I AFTER %s ON public.%I REFERENCING %s FOR EACH STATEMENT EXECUTE FUNCTION public.%I()',
                     r.nome, r.evento, r.tabela, r.transicao, r.fn);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_modelo_ins' AND tgrelid = 'public.modelos'::regclass) THEN
    CREATE TRIGGER trg_custo_fila_modelo_ins
      AFTER INSERT ON public.modelos
      FOR EACH ROW WHEN (NEW.origem = 'interno')
      EXECUTE FUNCTION public.fn_custo_fila_modelo();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_modelo_upd' AND tgrelid = 'public.modelos'::regclass) THEN
    CREATE TRIGGER trg_custo_fila_modelo_upd
      AFTER UPDATE ON public.modelos
      FOR EACH ROW WHEN (OLD.custos_adicionais IS DISTINCT FROM NEW.custos_adicionais OR OLD.origem IS DISTINCT FROM NEW.origem)
      EXECUTE FUNCTION public.fn_custo_fila_modelo();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_modelo_custo_derivado' AND tgrelid = 'public.modelos'::regclass) THEN
    CREATE TRIGGER trg_modelo_custo_derivado
      BEFORE UPDATE ON public.modelos
      FOR EACH ROW WHEN (OLD.custo_peca_previsto IS DISTINCT FROM NEW.custo_peca_previsto
                         OR OLD.custo_tecido_total IS DISTINCT FROM NEW.custo_tecido_total
                         OR OLD.custo_forro_total IS DISTINCT FROM NEW.custo_forro_total
                         OR OLD.custo_entretela_total IS DISTINCT FROM NEW.custo_entretela_total
                         OR OLD.custo_aviamento_total IS DISTINCT FROM NEW.custo_aviamento_total)
      EXECUTE FUNCTION public.fn_modelo_custo_derivado();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_processar_fila' AND tgrelid = 'public.custo_recalculo_fila'::regclass) THEN
    CREATE CONSTRAINT TRIGGER trg_custo_processar_fila
      AFTER INSERT OR UPDATE OF criado_at ON public.custo_recalculo_fila
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.fn_custo_processar_fila();
  END IF;
  -- reaplicar depois do inverso (DISABLE TRIGGER): religa
  FOR r IN SELECT t.tgname, t.tgrelid::regclass AS tabela FROM pg_trigger t
            WHERE NOT t.tgisinternal AND t.tgenabled <> 'O'
              AND (t.tgname LIKE 'trg\_custo\_%' OR t.tgname = 'trg_modelo_custo_derivado') LOOP
    EXECUTE format('ALTER TABLE %s ENABLE TRIGGER %I', r.tabela, r.tgname);
  END LOOP;
END $gatilhos$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
  v_n integer;
BEGIN
  -- funcoes: texto de DEPOIS
  FOR r IN SELECT assinatura, md5 FROM _cc_c1_md5 WHERE papel IN ('novo', 'depois') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_c1: % nao ficou com o texto deste arquivo (md5 %)', r.assinatura, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- #9: nenhum "_"/fn_ novo executavel por anon/authenticated (PUBLIC revogado: anon/authenticated nao herdam)
  FOR r IN SELECT DISTINCT assinatura FROM _cc_c1_md5 WHERE papel = 'novo' LOOP
    IF has_function_privilege('anon', r.assinatura, 'EXECUTE') OR has_function_privilege('authenticated', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'contas_certas_c1: % ficou executavel por anon/authenticated', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- o embrulho mantem o ACL de antes (authenticated sim, anon nao)
  IF NOT has_function_privilege('authenticated', 'public.precos_tecido_congelado(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.precos_tecido_congelado(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_c1: ACL de precos_tecido_congelado mudou' USING ERRCODE = 'P0001';
  END IF;
  -- fila: RLS ligada, nenhum acesso de cliente
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.custo_recalculo_fila'::regclass)
     OR has_table_privilege('authenticated', 'public.custo_recalculo_fila', 'SELECT')
     OR has_table_privilege('anon', 'public.custo_recalculo_fila', 'SELECT')
     OR has_table_privilege('authenticated', 'public.custo_recalculo_fila', 'INSERT')
     OR has_table_privilege('authenticated', 'public.custo_recalculo_fila', 'DELETE') THEN
    RAISE EXCEPTION 'contas_certas_c1: custo_recalculo_fila ficou acessivel ao cliente (ou sem RLS)' USING ERRCODE = 'P0001';
  END IF;
  -- gatilhos novos: todos ligados, com a definicao exata; os de STATEMENT sem lista de colunas (tgattr vazio) e com as
  -- tabelas de transicao certas
  SELECT count(*) INTO v_n
    FROM _cc_c1_gatilhos_novos g
    JOIN pg_trigger t ON t.tgname = g.nome AND t.tgrelid = to_regclass('public.' || g.tabela) AND NOT t.tgisinternal
   WHERE t.tgenabled = 'O'
     AND pg_get_triggerdef(t.oid) = g.def
     AND cardinality(t.tgattr::int2[]) = CASE WHEN g.nome = 'trg_custo_processar_fila' THEN 1 ELSE 0 END  -- a fila: UPDATE OF criado_at
     AND t.tgoldtable IS NOT DISTINCT FROM g.velha
     AND t.tgnewtable IS NOT DISTINCT FROM g.nova;
  IF v_n <> (SELECT count(*) FROM _cc_c1_gatilhos_novos) THEN
    FOR r IN SELECT g.tabela, g.nome, g.def, pg_get_triggerdef(t.oid) AS atual, t.tgenabled
               FROM _cc_c1_gatilhos_novos g
               LEFT JOIN pg_trigger t ON t.tgname = g.nome AND t.tgrelid = to_regclass('public.' || g.tabela) AND NOT t.tgisinternal
              WHERE t.oid IS NULL OR pg_get_triggerdef(t.oid) IS DISTINCT FROM g.def OR t.tgenabled <> 'O' LOOP
      RAISE WARNING 'contas_certas_c1: gatilho %.% -> atual [%] (habilitado %)', r.tabela, r.nome, r.atual, r.tgenabled;
    END LOOP;
    RAISE EXCEPTION 'contas_certas_c1: % de % gatilhos novos conferem (definicao/ligado/colunas/transicao)', v_n,
      (SELECT count(*) FROM _cc_c1_gatilhos_novos) USING ERRCODE = 'P0001';
  END IF;
  -- os gatilhos que ja existiam nas 13 tabelas continuam os mesmos
  IF EXISTS (
    SELECT 1
      FROM (SELECT g.tabela, g.md5 AS esperado,
                   md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), '')) AS atual
              FROM _cc_c1_gatilhos g
              LEFT JOIN pg_trigger t ON t.tgrelid = to_regclass('public.' || g.tabela) AND NOT t.tgisinternal
                                    AND t.tgname NOT LIKE 'trg\_custo\_%' AND t.tgname <> 'trg_modelo_custo_derivado'
             GROUP BY g.tabela, g.md5) s
     WHERE s.atual IS DISTINCT FROM s.esperado) THEN
    RAISE EXCEPTION 'contas_certas_c1: um gatilho que ja existia mudou' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
