-- Achados MEDIOS, release R15a (estoque de tecido; so banco, sem site) - parte 3: P-203 A (dono 01/out) - completar o
-- "Faltou estoque" do corte sozinho quando o tecido chega.
--   Hoje o _baixar_estoque_tecido_corte_core grava cad.deficit_corte (o que faltou baixar) e so um REENVIO ao corte o
--   refaz. Agora, quando um item de OC de tecido PASSA A CONTAR no estoque (OC muda para 'recebido'; quantidade_recebida/
--   pedida/cancelado/variante/troca/rolos_planejados gravados num item de OC recebida; item novo em OC recebida - rolo
--   criado/trocado, reposicao de troca recebida), o banco completa a baixa dos cad com deficit naquela variante:
--   * funcao NOVA _completar_deficit_corte_variante(_tenant, _variante) (regra no comentario dela): baixa SO o deficit
--     (nunca apaga/refaz as baixas existentes), corte mais antigo primeiro (data_enviado_corte, id), respeitando
--     modo_baixa_estoque (por_oc: vinculos do card primeiro - teto quantidade_m menos o ja baixado do item - depois FIFO;
--     automatico: so FIFO), saldo pela regra do core (saldo_oc_item_m/R11), o que nao couber fica no deficit_corte,
--     NULL quando zera (selo some), ledger com a origem do corte ('vinculo'/'fifo'), mesmo advisory lock do corte;
--   * funcao de gatilho NOVA fn_completar_deficit_corte() + 3 CONSTRAINT TRIGGERs NOVOS ADIADOS (INITIALLY DEFERRED: rodam
--     no COMMIT, depois de todos os itens da OC gravados): trg_deficit_corte_item_ins / trg_deficit_corte_item_upd em
--     ocs_tecido_itens e trg_deficit_corte_oc em ocs_tecido (UPDATE OF status, WHEN passou a 'recebido'). Erro vira
--     WARNING e nunca derruba o COMMIT de quem gravou.
--   Caminhos cobertos (todos gravam em ocs_tecido/ocs_tecido_itens): salvar_oc_tecido (receber/editar recebida),
--   receber_reposicao_troca, aplicar_resolucao_alerta_tecido (troca/cancelar: nao devolvem saldo, o gatilho nao acha nada),
--   criar_rolo/gerar_rolos_recebimento, trocar_rolo, ajustar_rolo, cancelar_rolo/reabrir_rolo, UPDATE direto do cliente.
--   NAO cobertos (so mexem no ledger): reverter "- Metragem" (reverter_ajuste_estoque), reverter/reenviar corte de OUTRO
--   card - o saldo devolvido so completa deficit no proximo evento de item daquela variante (decisao do dono se quiser).
--   Item com rolos_planejados ainda nao separado nao e fonte (gerar_rolos_recebimento roda logo depois do recebimento e
--   falharia por falta de saldo); o rolo criado dispara o gatilho e reabre a conta.
--   _baixar_estoque_tecido_corte_core NAO muda (guardado). NAO ha correcao unica: o efeito so vale em eventos futuros
--   (previa so-leitura do que completaria hoje: supabase/consultas/r15_deficit_corte_previa.sql).
--
-- FIX ROUND 1 (G-MIGRATION R15a, 01/out):
--   M2 o helper NUNCA espera dentro do COMMIT: pg_TRY_advisory_xact_lock (loja ocupada por um corte = nao faz agora; o
--      proximo evento de item da variante completa), cad pre-filtrados pela variante e travados com FOR UPDATE SKIP LOCKED,
--      lock_timeout 500 ms na funcao, orcamento de 4 s contados do inicio do COMMIT (statement_timestamp()); o gatilho pega
--      tambem query_canceled (57014), que o WHEN OTHERS nao pega - o COMMIT de quem gravou nunca e desfeito por esta frente.
--   M1 entrada malformada de deficit_corte (de qualquer variante) nao desliga a loja: pre-filtro por variante antes de
--      qualquer leitura, tipo/numero/ordem comparados como TEXTO, deficit/baixada so se numericos; a entrada ruim fica como
--      esta e e contada ({malformadas}); sub-bloco por cad (erro num cad = WARNING e segue). Contagem so-leitura para o
--      kit: supabase/consultas/r15_deficit_corte_malformadas.sql.
--   L3 o teste "ha deficit" e feito DEPOIS de pegar a trava da loja.
--   L4 o gatilho de UPDATE dos itens so dispara quando uma das colunas MUDA (WHEN OLD IS DISTINCT FROM NEW): o
--      _salvar_oc_tecido_core regrava todos os itens a cada salvar. INSERT tem gatilho proprio. 3 gatilhos:
--      trg_deficit_corte_item_ins, trg_deficit_corte_item_upd (ocs_tecido_itens) e trg_deficit_corte_oc (ocs_tecido).
--   L7 desempate: cortes do MESMO dia (data_enviado_corte e DATE) seguem a ordem do id, nao a hora do corte.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._completar_deficit_corte_variante(uuid,uuid)  NOVA: ausente (= producao), ou 70a91eef1ac40cce86ff7da8e6b14c7f (este arquivo,
--     fix round 1; reaplicar = no-op). O texto do round 0 (139886ea) NAO e aceito: desfazer com o _down + _down_drop antes.
--   public.fn_completar_deficit_corte()                    NOVA: ausente (= producao), ou 8432f313e038796f8776922d604be205 (este
--     arquivo), ou c09fc3f1f011918ea5eb7f11fc8b45e9 (NEUTRALIZADA pelo _down -> esta ida a restaura)
--   Gatilhos (conjunto = n:md5 de nome:habilitado:md5(triggerdef) em ordem de nome, igual ao Passo 0):
--     ocs_tecido        ANTES  9:3ce1ed0e9503b257c252701e4a1f07fd   -- PROVISORIO (copia 54422; tabela fora do Passo 0): conferir no Passo 0 do kit R15
--                       DEPOIS 10:320500b72b09f7bb72bc399f556965b9
--     ocs_tecido_itens  ANTES  2:17a42c7cfd8b461d12cf2605d63d7e04   -- PROVISORIO (copia 54422; tabela fora do Passo 0): conferir no Passo 0 do kit R15
--                       DEPOIS 4:01bd475466e7e45c7b93691afd66ed28
--   Sem mudanca (so guarda):
--     public._baixar_estoque_tecido_corte_core(uuid)  2a6f0ef24da6f9e8b9c68f63e3863577  INTOCADA  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     public.saldo_oc_item_m(uuid)                    873789084182322f0b28b315d06b0dbc  INTOCADA (regra do saldo replicada aqui) -- R11 "depois" (producao desde a release 10)
--   Qualquer outro estado -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: CREATE FUNCTION/CREATE OR REPLACE (objeto) + 3 CREATE CONSTRAINT TRIGGER = ShareRowExclusiveLock em ocs_tecido e
-- ocs_tecido_itens (bloqueia ESCRITA nas 2 tabelas por um instante; leitura segue). Medido na copia (pg_locks): so as 2
-- tabelas + catalogo; CREATE TRIGGER nao passa pelo supautils.policy_grants (medicao da C4) - quem prende auth/storage e o
-- DROP TRIGGER do _down_drop. lock_timeout 500ms: se alguem esta gravando OC, a migration falha inteira (nada fica) e e so
-- rodar de novo (idempotente) - horario calmo, ate 3 tentativas. Sem DROP. ACL: as 2 funcoes novas nascem SEM EXECUTE
-- para PUBLIC/anon/authenticated (inv. #9 - o helper recebe a loja por parametro; gatilho nao confere EXECUTE ao disparar).
-- Volta: supabase/rollback/20261025300000_completar_deficit_corte_down.sql NEUTRALIZA a funcao do gatilho (CREATE OR
-- REPLACE, sem trava de tabela, qualquer hora); supabase/rollback/20261025300000_completar_deficit_corte_down_drop.sql
-- (SEPARADO, opcional) faz DROP TRIGGER/DROP FUNCTION - DROP TRIGGER trava ~23 tabelas auth/storage/realtime ate o
-- COMMIT: horario calmo. Baixas ja completadas ficam no ledger (como um corte).
-- LIFO: o inverso desta roda ANTES dos inversos 20261025200000 e 20261025100000.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_set text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._baixar_estoque_tecido_corte_core(uuid)', '2a6f0ef24da6f9e8b9c68f63e3863577'),
      ('public.saldo_oc_item_m(uuid)',                   '873789084182322f0b28b315d06b0dbc')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r15a_p203: % nao existe neste banco', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r15a_p203: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public._completar_deficit_corte_variante(uuid,uuid)') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public._completar_deficit_corte_variante(uuid,uuid)'))) <> '70a91eef1ac40cce86ff7da8e6b14c7f' THEN
    RAISE EXCEPTION 'medios_r15a_p203: _completar_deficit_corte_variante existe com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_completar_deficit_corte()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.fn_completar_deficit_corte()')))
         NOT IN ('8432f313e038796f8776922d604be205', 'c09fc3f1f011918ea5eb7f11fc8b45e9') THEN
    RAISE EXCEPTION 'medios_r15a_p203: fn_completar_deficit_corte existe com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido',       '9:3ce1ed0e9503b257c252701e4a1f07fd', '10:320500b72b09f7bb72bc399f556965b9'),
      ('ocs_tecido_itens', '2:17a42c7cfd8b461d12cf2605d63d7e04', '4:01bd475466e7e45c7b93691afd66ed28')) v(tab, antes, depois) LOOP
    IF to_regclass('public.' || r.tab) IS NULL THEN
      RAISE EXCEPTION 'medios_r15a_p203: tabela % ausente', r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'medios_r15a_p203: gatilhos de % fora do esperado (%) - outra frente mexeu; conferir o Passo 0', r.tab, v_set
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._completar_deficit_corte_variante(_tenant uuid, _variante uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '500ms'
AS $function$
-- [medios R15 P-203 A] Completa o "Faltou estoque" do CORTE quando chega tecido da variante: para cada cad da loja
-- ENVIADO ao corte com deficit_corte nesta variante, baixa SO o deficit (nunca apaga/refaz as baixas existentes - nao
-- e um reenvio), com a mesma regua do _baixar_estoque_tecido_corte_core:
--   * saldo do item = regra do core/saldo_oc_item_m (R11): OC RECEBIDA, item nao cancelado, recebida senao pedida (0 se
--     troca), kg->m, menos as baixas do item. Calculado aqui com a loja do parametro (sem JWT: roda no COMMIT, por gatilho);
--   * modo_baixa_estoque 'por_oc': 1a passada = os VINCULOS de cada card (prioridade, oc_tecido_item_id), teto =
--     quantidade_m (se > 0) MENOS o que o card ja baixou daquele item; 2a passada = FIFO (data_entrega, created_at)
--     fora os itens vinculados daquela linha do card. 'automatico': so FIFO. As duas passadas vao do corte mais antigo
--     para o mais novo (data_enviado_corte, depois id - cortes do MESMO dia ficam na ordem do id, nao na hora do corte)
--     - o vinculo de um card mais novo vem antes do FIFO de um mais antigo (o vinculo e reserva);
--   * item de OC com rolos planejados (rolos_planejados) ainda NAO separados nao e fonte: a separacao em rolos vem logo
--     depois do recebimento (gerar_rolos_recebimento) e falharia por falta de saldo; o rolo criado reabre a conta;
--   * o que nao couber continua no deficit_corte (enviada/baixada/deficit atualizados); deficit zerado sai da lista;
--     lista vazia -> deficit_corte NULL (o selo "Faltou estoque" some);
--   * ledger estoque_tecido_baixas com a mesma origem do corte ('vinculo'/'fifo'); auditoria pega (fn_audit);
--   * idempotente (sem deficit ou sem saldo = nada). Devolve {cads, metros, malformadas, ocupado, adiado}.
-- [fix round 1 - G-MIGRATION R15a]
--   M2 NUNCA ESPERA dentro do COMMIT: trava da loja por pg_TRY_advisory_xact_lock('corte_tenant:') (ocupada = um corte/
--      completar em curso -> nao faz agora, o proximo evento de item da variante completa; {ocupado:true}); cad travado
--      por outra transacao = SKIP LOCKED (esta sendo cortado/reenviado - o reenvio refaz a conta); lock_timeout 500 ms
--      nas demais esperas (erro vira WARNING no gatilho); ORCAMENTO de 4 s contados do inicio do comando
--      (statement_timestamp(): o COMMIT inteiro, com os outros gatilhos adiados) - passou, para e deixa para o proximo
--      evento ({adiado:true}). O statement_timeout de authenticated (8 s) nao e atingido por esta funcao.
--   M1 entrada malformada de deficit_corte (de qualquer variante) nao desliga a loja: os cad sao PRE-FILTRADOS pela
--      variante (EXISTS cad_tecido_variantes) ANTES de travar; tipo/numero/ordem comparados como TEXTO; deficit/baixada
--      lidos so se numericos (regex); entrada fora do formato e mantida como esta e CONTADA (malformadas); cada cad roda
--      num sub-bloco proprio (erro num cad = WARNING e segue para o proximo, o que ele baixou e desfeito).
--   L3 o teste "ha deficit" e feito DEPOIS de pegar a trava da loja.
DECLARE
  c_orcamento CONSTANT interval := interval '4 seconds';
  v_prazo timestamptz := statement_timestamp() + c_orcamento;
  v_modo text;
  v_passada int;
  c record;
  e jsonb;
  v_nova jsonb;
  v_mudou boolean;
  v_restante numeric;
  v_baixado numeric;
  v_consumir numeric;
  v_ctv record;
  vlink record;
  lote record;
  v_ja numeric;
  v_limite numeric;
  v_links uuid[];
  v_cads int := 0;
  v_total numeric := 0;
  v_ruins int := 0;
  v_tocados uuid[] := ARRAY[]::uuid[];
  v_adiado boolean := false;
  v_cad_total numeric;
  v_cad_ruins int;
  c_num CONSTANT text := '^\s*[0-9]+(\.[0-9]+)?\s*$';
BEGIN
  IF _tenant IS NULL OR _variante IS NULL THEN
    RETURN jsonb_build_object('cads', 0, 'metros', 0);
  END IF;
  IF clock_timestamp() >= v_prazo THEN
    RETURN jsonb_build_object('cads', 0, 'metros', 0, 'adiado', true);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('corte_tenant:' || _tenant::text)) THEN
    RETURN jsonb_build_object('cads', 0, 'metros', 0, 'ocupado', true);
  END IF;
  -- (L3) sob a trava: algum cad da loja enviado ao corte com deficit E com uma linha de corte desta variante?
  IF NOT EXISTS (SELECT 1 FROM public.cad cd
                  WHERE cd.tenant_id = _tenant AND cd.enviado_corte
                    AND (CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array'
                              THEN jsonb_array_length(cd.deficit_corte) > 0 ELSE false END)
                    AND EXISTS (SELECT 1 FROM public.cad_tecidos ct
                                  JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
                                 WHERE ct.cad_id = cd.id AND ctv.variante_tecido_id = _variante)) THEN
    RETURN jsonb_build_object('cads', 0, 'metros', 0);
  END IF;

  SELECT COALESCE(modo_baixa_estoque, 'por_oc') INTO v_modo FROM public.tenant_config WHERE tenant_id = _tenant;
  v_modo := COALESCE(v_modo, 'por_oc');

  <<passadas>>
  FOR v_passada IN 1..2 LOOP
    CONTINUE WHEN v_passada = 1 AND v_modo <> 'por_oc';
    FOR c IN
      SELECT cd.id, cd.modelo_id, cd.deficit_corte
        FROM public.cad cd
       WHERE cd.tenant_id = _tenant AND cd.enviado_corte
         AND (CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array'
                   THEN jsonb_array_length(cd.deficit_corte) > 0 ELSE false END)
         AND EXISTS (SELECT 1 FROM public.cad_tecidos ct
                       JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
                      WHERE ct.cad_id = cd.id AND ctv.variante_tecido_id = _variante)
       ORDER BY cd.data_enviado_corte NULLS LAST, cd.id
       FOR UPDATE OF cd SKIP LOCKED
    LOOP
      IF clock_timestamp() >= v_prazo THEN
        v_adiado := true;
        EXIT passadas;
      END IF;
      BEGIN
        v_nova := '[]'::jsonb;
        v_mudou := false;
        v_cad_total := 0;
        v_cad_ruins := 0;
        FOR e IN SELECT value FROM jsonb_array_elements(c.deficit_corte) LOOP
          -- entrada fora do formato (nao objeto, deficit nao numerico): mantem como esta e conta
          IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR COALESCE(e->>'deficit', '') !~ c_num
             OR COALESCE(e->>'numero', '') !~ '^[0-9]+$' OR COALESCE(e->>'ordem', '') !~ '^[0-9]+$' THEN
            v_cad_ruins := v_cad_ruins + 1;
            v_nova := v_nova || jsonb_build_array(e);
            CONTINUE;
          END IF;
          v_restante := (e->>'deficit')::numeric;
          -- a linha do corte (tipo, numero, ordem - comparados como TEXTO) tem de ser DESTA variante
          SELECT ct.tipo, ct.numero, ctv.ordem INTO v_ctv
            FROM public.cad_tecidos ct
            JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
           WHERE ct.cad_id = c.id
             AND ct.tipo::text = (e->>'tipo') AND ct.numero::text = (e->>'numero') AND ctv.ordem::text = (e->>'ordem')
             AND ctv.variante_tecido_id = _variante
           LIMIT 1;
          IF NOT FOUND OR v_restante <= 0.0001 THEN
            v_nova := v_nova || jsonb_build_array(e);
            CONTINUE;
          END IF;

          SELECT COALESCE(array_agg(l.oc_tecido_item_id), ARRAY[]::uuid[]) INTO v_links
            FROM public.modelo_tecido_oc_links l
           WHERE l.modelo_id = c.modelo_id AND l.tipo = v_ctv.tipo AND l.numero = v_ctv.numero
             AND l.ordem = v_ctv.ordem AND l.variante_tecido_id = _variante;

          v_baixado := 0;
          IF v_passada = 1 THEN
            FOR vlink IN
              SELECT l.oc_tecido_item_id, COALESCE(l.quantidade_m, 0) AS quantidade_m
                FROM public.modelo_tecido_oc_links l
               WHERE l.modelo_id = c.modelo_id AND l.tipo = v_ctv.tipo AND l.numero = v_ctv.numero
                 AND l.ordem = v_ctv.ordem AND l.variante_tecido_id = _variante
               ORDER BY COALESCE(l.prioridade, 1), l.oc_tecido_item_id
            LOOP
              EXIT WHEN v_restante <= 0.0001;
              SELECT s.saldo INTO lote FROM (
                SELECT CASE WHEN COALESCE(it.cancelado, false) OR oc.status IS DISTINCT FROM 'recebido' THEN 0::numeric
                            ELSE (CASE WHEN a.unidade_medida = 'kg'
                                       THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento, 0)
                                       ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END)
                                 - COALESCE((SELECT SUM(b.quantidade) FROM public.estoque_tecido_baixas b WHERE b.oc_tecido_item_id = it.id), 0)
                       END AS saldo
                  FROM public.ocs_tecido_itens it
                  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = _tenant
                  LEFT JOIN public.artigos a ON a.id = it.artigo_id
                 WHERE it.id = vlink.oc_tecido_item_id
                   AND it.variante_tecido_id = _variante
                   AND NOT (COALESCE(oc.is_rolo, false) = false
                            AND (CASE WHEN jsonb_typeof(it.rolos_planejados) = 'array'
                                      THEN jsonb_array_length(it.rolos_planejados) > 0 ELSE false END)
                            AND NOT EXISTS (SELECT 1 FROM public.estoque_tecido_baixas bs
                                             WHERE bs.oc_tecido_item_id = it.id AND bs.origem = 'separacao_rolo'))
              ) s;
              CONTINUE WHEN NOT FOUND OR COALESCE(lote.saldo, 0) <= 0;
              IF vlink.quantidade_m > 0 THEN
                SELECT COALESCE(SUM(b.quantidade), 0) INTO v_ja FROM public.estoque_tecido_baixas b
                 WHERE b.cad_id = c.id AND b.oc_tecido_item_id = vlink.oc_tecido_item_id;
                v_limite := GREATEST(0, vlink.quantidade_m - v_ja);
              ELSE
                v_limite := v_restante;
              END IF;
              v_consumir := LEAST(v_restante, lote.saldo, v_limite);
              CONTINUE WHEN v_consumir <= 0;
              INSERT INTO public.estoque_tecido_baixas
                (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
              VALUES (_tenant, c.id, _variante, vlink.oc_tecido_item_id, v_consumir, 'vinculo');
              v_restante := v_restante - v_consumir;
              v_baixado := v_baixado + v_consumir;
            END LOOP;
          ELSE
            FOR lote IN
              SELECT x.item_id, x.saldo FROM (
                SELECT it.id AS item_id, oc.data_entrega, oc.created_at,
                       (CASE WHEN a.unidade_medida = 'kg'
                             THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento, 0)
                             ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END)
                       - COALESCE((SELECT SUM(b.quantidade) FROM public.estoque_tecido_baixas b WHERE b.oc_tecido_item_id = it.id), 0) AS saldo
                  FROM public.ocs_tecido_itens it
                  JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
                  LEFT JOIN public.artigos a ON a.id = it.artigo_id
                 WHERE oc.tenant_id = _tenant
                   AND oc.status = 'recebido'
                   AND COALESCE(it.cancelado, false) = false
                   AND it.variante_tecido_id = _variante
                   AND (v_modo <> 'por_oc' OR NOT (it.id = ANY (v_links)))
                   AND NOT (COALESCE(oc.is_rolo, false) = false
                            AND (CASE WHEN jsonb_typeof(it.rolos_planejados) = 'array'
                                      THEN jsonb_array_length(it.rolos_planejados) > 0 ELSE false END)
                            AND NOT EXISTS (SELECT 1 FROM public.estoque_tecido_baixas bs
                                             WHERE bs.oc_tecido_item_id = it.id AND bs.origem = 'separacao_rolo'))
              ) x
              WHERE x.saldo > 0
              ORDER BY x.data_entrega NULLS LAST, x.created_at
            LOOP
              EXIT WHEN v_restante <= 0.0001;
              v_consumir := LEAST(v_restante, lote.saldo);
              INSERT INTO public.estoque_tecido_baixas
                (tenant_id, cad_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem)
              VALUES (_tenant, c.id, _variante, lote.item_id, v_consumir, 'fifo');
              v_restante := v_restante - v_consumir;
              v_baixado := v_baixado + v_consumir;
            END LOOP;
          END IF;

          IF v_baixado > 0 THEN
            v_mudou := true;
            IF v_restante > 0.0001 THEN
              v_nova := v_nova || jsonb_build_array(e || jsonb_build_object(
                'baixada', round(CASE WHEN COALESCE(e->>'baixada', '') ~ c_num THEN (e->>'baixada')::numeric ELSE 0 END + v_baixado, 4),
                'deficit', round(v_restante, 4)));
            END IF;
            v_cad_total := v_cad_total + v_baixado;
          ELSE
            v_nova := v_nova || jsonb_build_array(e);
          END IF;
        END LOOP;

        IF v_mudou THEN
          UPDATE public.cad SET deficit_corte = NULLIF(v_nova, '[]'::jsonb) WHERE id = c.id;
          IF NOT (c.id = ANY (v_tocados)) THEN
            v_tocados := array_append(v_tocados, c.id);
            v_cads := v_cads + 1;
          END IF;
        END IF;
        v_total := v_total + v_cad_total;
        IF v_passada = 2 THEN
          v_ruins := v_ruins + v_cad_ruins;   -- conta uma vez (a 2a passada sempre roda)
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- erro neste cad: o que ele baixou nesta passada e desfeito; segue para o proximo
        RAISE WARNING 'completar_deficit_corte: cad % pulado (%: %)', c.id, SQLSTATE, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('cads', v_cads, 'metros', round(v_total, 4), 'malformadas', v_ruins, 'adiado', v_adiado);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._completar_deficit_corte_variante(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_completar_deficit_corte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R15 P-203 A] Funcao dos gatilhos ADIADOS (CONSTRAINT TRIGGER ... INITIALLY DEFERRED, rodam no COMMIT):
--   trg_deficit_corte_item_ins  ocs_tecido_itens AFTER INSERT (item com variante)          -> a variante do item
--   trg_deficit_corte_item_upd  ocs_tecido_itens AFTER UPDATE OF quantidade_recebida, quantidade_pedida, cancelado,
--                               variante_tecido_id, substitui_item_id, rolos_planejados WHEN algum deles MUDOU (fix
--                               round 1, L4: o _salvar_oc_tecido_core regrava todos os itens a cada salvar)
--   trg_deficit_corte_oc        ocs_tecido AFTER UPDATE OF status (WHEN passou a 'recebido') -> as variantes da OC
-- So age se a OC esta RECEBIDA no COMMIT (o item passou a contar: OC recebida, recebida gravada/alterada, reposicao de
-- troca recebida, rolo criado/ajustado/trocado). Chama _completar_deficit_corte_variante(loja, variante). Erro vira so
-- WARNING (ASCII) e nunca derruba o COMMIT de quem gravou (o deficit fica como estava e a tela segue mostrando) -
-- inclusive 57014 (query_canceled, que o WHEN OTHERS nao pega). O helper nunca espera trava (fix round 1, M2).
DECLARE
  v_tenant uuid;
  v_status text;
  v_var uuid;
BEGIN
  IF TG_TABLE_NAME = 'ocs_tecido_itens' THEN
    IF NEW.variante_tecido_id IS NULL OR NEW.oc_tecido_id IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT oc.tenant_id, oc.status INTO v_tenant, v_status FROM public.ocs_tecido oc WHERE oc.id = NEW.oc_tecido_id;
    IF v_tenant IS NULL OR v_status IS DISTINCT FROM 'recebido' THEN
      RETURN NULL;
    END IF;
    BEGIN
      PERFORM public._completar_deficit_corte_variante(v_tenant, NEW.variante_tecido_id);
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      RAISE WARNING 'completar_deficit_corte: variante % nao completada (%: %)', NEW.variante_tecido_id, SQLSTATE, SQLERRM;
    END;
  ELSIF TG_TABLE_NAME = 'ocs_tecido' THEN
    SELECT oc.tenant_id, oc.status INTO v_tenant, v_status FROM public.ocs_tecido oc WHERE oc.id = NEW.id;
    IF v_tenant IS NULL OR v_status IS DISTINCT FROM 'recebido' THEN
      RETURN NULL;
    END IF;
    FOR v_var IN
      SELECT DISTINCT it.variante_tecido_id FROM public.ocs_tecido_itens it
       WHERE it.oc_tecido_id = NEW.id AND it.variante_tecido_id IS NOT NULL AND COALESCE(it.cancelado, false) = false
    LOOP
      BEGIN
        PERFORM public._completar_deficit_corte_variante(v_tenant, v_var);
      EXCEPTION WHEN query_canceled OR OTHERS THEN
        RAISE WARNING 'completar_deficit_corte: variante % nao completada (%: %)', v_var, SQLSTATE, SQLERRM;
      END;
    END LOOP;
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_completar_deficit_corte() FROM PUBLIC, anon, authenticated;

-- gatilhos (cria se falta - sem DROP; a guarda ja garantiu que, se existe, e o deste arquivo)
DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_deficit_corte_item_ins'
                 AND tgrelid = to_regclass('public.ocs_tecido_itens')) THEN
    CREATE CONSTRAINT TRIGGER trg_deficit_corte_item_ins
      AFTER INSERT ON public.ocs_tecido_itens
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.variante_tecido_id IS NOT NULL)
      EXECUTE FUNCTION public.fn_completar_deficit_corte();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_deficit_corte_item_upd'
                 AND tgrelid = to_regclass('public.ocs_tecido_itens')) THEN
    CREATE CONSTRAINT TRIGGER trg_deficit_corte_item_upd
      AFTER UPDATE OF quantidade_recebida, quantidade_pedida, cancelado, variante_tecido_id, substitui_item_id, rolos_planejados
      ON public.ocs_tecido_itens
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.variante_tecido_id IS NOT NULL AND (
           OLD.quantidade_recebida IS DISTINCT FROM NEW.quantidade_recebida
        OR OLD.quantidade_pedida IS DISTINCT FROM NEW.quantidade_pedida
        OR OLD.cancelado IS DISTINCT FROM NEW.cancelado
        OR OLD.variante_tecido_id IS DISTINCT FROM NEW.variante_tecido_id
        OR OLD.substitui_item_id IS DISTINCT FROM NEW.substitui_item_id
        OR OLD.rolos_planejados IS DISTINCT FROM NEW.rolos_planejados))
      EXECUTE FUNCTION public.fn_completar_deficit_corte();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_deficit_corte_oc'
                 AND tgrelid = to_regclass('public.ocs_tecido')) THEN
    CREATE CONSTRAINT TRIGGER trg_deficit_corte_oc
      AFTER UPDATE OF status ON public.ocs_tecido
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.status::text = 'recebido' AND OLD.status IS DISTINCT FROM NEW.status)
      EXECUTE FUNCTION public.fn_completar_deficit_corte();
  END IF;
END $gatilho$;

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._completar_deficit_corte_variante(uuid,uuid)', '70a91eef1ac40cce86ff7da8e6b14c7f'),
      ('public.fn_completar_deficit_corte()',                   '8432f313e038796f8776922d604be205'),
      ('public._baixar_estoque_tecido_corte_core(uuid)',        '2a6f0ef24da6f9e8b9c68f63e3863577'),
      ('public.saldo_oc_item_m(uuid)',                          '873789084182322f0b28b315d06b0dbc')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r15a_p203: pos-condicao falhou - % nao ficou com o texto esperado', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: as 2 funcoes novas sem EXECUTE para PUBLIC/anon/authenticated
  FOR r IN SELECT * FROM (VALUES ('public._completar_deficit_corte_variante(uuid,uuid)'), ('public.fn_completar_deficit_corte()')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15a_p203: % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido_itens', 'trg_deficit_corte_item_ins', '4:01bd475466e7e45c7b93691afd66ed28',
       'CREATE CONSTRAINT TRIGGER trg_deficit_corte_item_ins AFTER INSERT ON public.ocs_tecido_itens DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((new.variante_tecido_id IS NOT NULL)) EXECUTE FUNCTION fn_completar_deficit_corte()'),
      ('ocs_tecido_itens', 'trg_deficit_corte_item_upd', '4:01bd475466e7e45c7b93691afd66ed28',
       'CREATE CONSTRAINT TRIGGER trg_deficit_corte_item_upd AFTER UPDATE OF quantidade_recebida, quantidade_pedida, cancelado, variante_tecido_id, substitui_item_id, rolos_planejados ON public.ocs_tecido_itens DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.variante_tecido_id IS NOT NULL) AND ((old.quantidade_recebida IS DISTINCT FROM new.quantidade_recebida) OR (old.quantidade_pedida IS DISTINCT FROM new.quantidade_pedida) OR (old.cancelado IS DISTINCT FROM new.cancelado) OR (old.variante_tecido_id IS DISTINCT FROM new.variante_tecido_id) OR (old.substitui_item_id IS DISTINCT FROM new.substitui_item_id) OR (old.rolos_planejados IS DISTINCT FROM new.rolos_planejados)))) EXECUTE FUNCTION fn_completar_deficit_corte()'),
      ('ocs_tecido', 'trg_deficit_corte_oc', '10:320500b72b09f7bb72bc399f556965b9',
       'CREATE CONSTRAINT TRIGGER trg_deficit_corte_oc AFTER UPDATE OF status ON public.ocs_tecido DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN ((((new.status)::text = ''recebido''::text) AND ((old.status)::text IS DISTINCT FROM (new.status)::text))) EXECUTE FUNCTION fn_completar_deficit_corte()')
    ) v(tab, tg, depois, def) LOOP
    IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = r.tg
          AND t.tgrelid = to_regclass('public.' || r.tab) AND t.tgenabled = 'O') IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION 'medios_r15a_p203: gatilho % de % ausente, desligado ou diferente', r.tg, r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.depois THEN
      RAISE EXCEPTION 'medios_r15a_p203: pos-condicao falhou - gatilhos de % = % (esperado %)', r.tab, v_set, r.depois USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
