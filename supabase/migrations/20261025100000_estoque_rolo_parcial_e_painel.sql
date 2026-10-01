-- Achados MEDIOS, release R15a (estoque de tecido; so banco, sem site) - parte 1: est #4 + est #2.
--   est #4  _estoque_tecido_core (fonte unica, inv. #4) EXCLUIA INTEIRO o item de ORIGEM de rolo (CTE origem_rolos): a
--           parte NAO separada (e as baixas dela) sumia do estoque. Agora todo item conta; a separacao de rolo vira
--           TRANSFERENCIA: a baixa 'separacao_rolo' sai do RECEBIDO do item de origem (o rolo e que recebe) e NAO entra
--           na BAIXA. Fisico da variante = recebido - baixas (com clamp >= 0 POR VARIANTE, inv. #4; rulings 01/out);
--           "Recebido" nao conta 2x o que foi separado. Separar tudo = igual a hoje.
--   est #2  detalhe_estoque_variante (painel "Estoque por OC") refazia a reserva por vinculo (demanda INTEIRA em cada
--           vinculo, so liberava com baixa no ledger, nao excluia reprovado) -> painel > core (Passo 0 producao: Ave
--           Rara 23, Loja Teste 2; copia 17 + 2). Agora: linhas com a MESMA regra por item do core (o item de origem de
--           rolo aparece; recebido menos a separacao; baixa/recebido so de OC recebida); reserva = a do core (cards nao
--           reprovados e nao enviados ao corte) REPARTIDA pelos vinculos do card na ordem do corte (prioridade,
--           oc_tecido_item_id; teto quantidade_m > 0; o ULTIMO vinculo leva o resto = repartirDemanda / Situacao por OC,
--           P-168 A). "Reserva sem OC" (front, EstoqueTecidosTab.tsx) = reservado do core - Sigma das linhas, >= 0 por
--           construcao. Formato da resposta (chaves) igual: o front nao muda.
-- PRE-CONDICAO DENTRO DA MIGRATION (plan.md R15; Passo 0 de producao 01/out 11:06): recalcula TODAS as variantes de
-- TODAS as lojas com o texto de antes e o de depois e ABORTA (P0001) se:
--   (a) a_receber (prev_receb_m) ou reservado mudar em qualquer variante;
--   (b) fisico/previsto mudar numa variante FORA da lista _r15_esperados (abaixo), ou o delta do fisico de uma
--       variante da lista sair do esperado (tolerancia 0,001 m), ou previsto mudar diferente do fisico;
--   (c) recebido/baixa mudarem numa variante SEM item de origem de rolo (so a origem de rolo pode mexer nessas colunas).
-- LISTA ESPERADA (constante; o kit confere): producao = Ave Rara:9cc99d86 (delta 0) + French:28e180c5 (-1 m, 1024 -> 1023).
-- Na copia 54422 so a French muda o fisico (-1); Loja Teste:caf20841 muda recebido e baixa (+80,54 cada, fisico igual).
-- Cada variante que muda sai num NOTICE (loja:variante8 campos antes>depois).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06) - md5 "antes" da copia 54422 = producao.
--   public._estoque_tecido_core(uuid)
--     ANTES  ffae03c900aa9335e2c6827a8e26cfe7  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 7e48c553b050eb47f9eff694f9a5d8cf  (este arquivo; reaplicar = no-op)
--   public.detalhe_estoque_variante(uuid)
--     ANTES  25acef268f8837c6476b042e6ca1cfa1  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS effb1f49e05a384621203f42d4c6552f  (este arquivo; reaplicar = no-op)
--   Leitores SEM mudanca (so guarda; rolam o core):
--     public.estoque_tecido()                    15ae9401fc1c6901ed4070be1bab3f9f  -- CONFIRMADO: Passo 0 (01/out 11:06)
--     public.estoque_tecido_por_artigo()         4bda9bbbd94b9315a72b1e36d44184ba  -- CONFIRMADO: Passo 0 (01/out 11:06)
--     public.dashboard_estoque()                 6f51a812f2b074aa3051c87d08ce7072  -- CONFIRMADO: Passo 0 (01/out 11:06)
--     public._dashboard_estoque_parado_core()    bcc701390b3f2d2c71e61d730cd3ec3f  -- CONFIRMADO: Passo 0 (01/out 11:06)
--     public._grade_soma_pares(uuid,uuid[])      0366b1458fe23e1cca1be244433a93f8  -- CONFIRMADO: Passo 0 (01/out 11:06) (usada)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava do objeto funcao; nada em tabela, nada em auth/storage). A pre-condicao so
-- LE (2 x o core por loja; copia: 408 variantes em < 1 s). Sem DDL de tabela, sem DROP, sem funcao nova. ACL: CREATE OR
-- REPLACE mantem a de hoje (_estoque_tecido_core sem EXECUTE para PUBLIC/anon/authenticated - inv. #9;
-- detalhe_estoque_variante so authenticated/service_role) - conferido no fim.
-- Volta: supabase/rollback/20261025100000_estoque_rolo_parcial_e_painel_down.sql (devolve os 2 textos de antes, com
-- guarda dos de depois). Nada gravado muda na ida nem na volta (so leitura).
-- LIFO: o inverso desta roda ANTES do inverso da R11 (20261021100000) por convencao (nenhum confere estas funcoes).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

-- LISTA ESPERADA da pre-condicao (loja, 8 primeiros do id da variante, delta esperado do fisico em m) - Passo 0 producao.
CREATE TEMP TABLE _r15_esperados (loja text, variante8 text, delta_fisico numeric) ON COMMIT DROP;
INSERT INTO _r15_esperados VALUES
  ('Ave Rara', '9cc99d86',  0),   -- Passo 0 producao: delta bruto ~0 (665,1640 > 665,1640)
  ('French',   '28e180c5', -1);   -- Passo 0 producao e copia: 1024 > 1023 (1.000 recebidos x 1.001 separados)

CREATE TEMP TABLE _r15a_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r15a_md5_aceitos VALUES
  ('public._estoque_tecido_core(uuid)',               'ffae03c900aa9335e2c6827a8e26cfe7', 'antes'),     -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._estoque_tecido_core(uuid)',               '7e48c553b050eb47f9eff694f9a5d8cf', 'depois'),
  ('public.detalhe_estoque_variante(uuid)',           '25acef268f8837c6476b042e6ca1cfa1', 'antes'),     -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public.detalhe_estoque_variante(uuid)',           'effb1f49e05a384621203f42d4c6552f', 'depois'),
  ('public.estoque_tecido()',                         '15ae9401fc1c6901ed4070be1bab3f9f', 'leitor'),    -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public.estoque_tecido_por_artigo()',              '4bda9bbbd94b9315a72b1e36d44184ba', 'leitor'),    -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public.dashboard_estoque()',                      '6f51a812f2b074aa3051c87d08ce7072', 'leitor'),    -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._dashboard_estoque_parado_core()',         'bcc701390b3f2d2c71e61d730cd3ec3f', 'leitor'),    -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._grade_soma_pares(uuid,uuid[])',           '0366b1458fe23e1cca1be244433a93f8', 'leitor');    -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r15a_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r15a: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r15a_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r15a: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- retrato do core com o texto ATUAL (antes), todas as lojas
CREATE TEMP TABLE _r15_core_antes ON COMMIT DROP AS
  SELECT t.id AS tenant_id, t.nome::text AS loja, c.*
    FROM public.tenants t CROSS JOIN LATERAL public._estoque_tecido_core(t.id) c;

CREATE OR REPLACE FUNCTION public._estoque_tecido_core(_tenant uuid)
 RETURNS TABLE(variante_tecido_id uuid, artigo_id uuid, prev_receb_m numeric, recebido_m numeric, baixa numeric, reservado numeric, fisico numeric, previsto numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [medios R15 est #4] O item de ORIGEM de rolo deixou de ser excluido inteiro (a CTE origem_rolos jogava fora a parte
  -- NAO separada e as baixas dela). Agora todo item conta; a separacao de rolo e TRANSFERENCIA (sai da origem, entra no
  -- item do rolo): a baixa 'separacao_rolo' sai do recebido do item de origem e NAO entra na baixa - assim a origem conta
  -- recebido - separacao - (cortes/ajustes dela) e o "Recebido" da variante nao conta 2x o que foi separado. Fisico da
  -- variante = recebido - baixas, clamp >= 0 POR VARIANTE (inv. #4). Resto do texto igual ao de antes.
  WITH
  itens AS (
    SELECT it.id, it.variante_tecido_id, it.artigo_id, it.quantidade_pedida, it.quantidade_recebida,
           it.substitui_item_id, oc.status,
           a.unidade_medida, COALESCE(a.rendimento, 0) AS rendimento
    FROM ocs_tecido_itens it
    JOIN ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = _tenant
    LEFT JOIN artigos a ON a.id = it.artigo_id
    WHERE it.variante_tecido_id IS NOT NULL
      AND COALESCE(it.cancelado, false) = false
  ),
  prev AS (
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg' THEN COALESCE(quantidade_pedida,0) * rendimento
                    ELSE COALESCE(quantidade_pedida,0) END) AS m
    FROM itens WHERE status = 'encomendado'
    GROUP BY variante_tecido_id
  ),
  separado AS (
    SELECT i.variante_tecido_id, SUM(COALESCE(b.quantidade, 0)) AS m
    FROM itens i
    JOIN estoque_tecido_baixas b ON b.oc_tecido_item_id = i.id AND b.origem = 'separacao_rolo'
    WHERE i.status = 'recebido'
    GROUP BY i.variante_tecido_id
  ),
  receb AS (
    SELECT variante_tecido_id,
           SUM(CASE WHEN unidade_medida = 'kg'
                    THEN COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) * rendimento
                    ELSE COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) END) AS m
    FROM itens WHERE status = 'recebido'
    GROUP BY variante_tecido_id
  ),
  baixa_led AS (
    SELECT i.variante_tecido_id, SUM(COALESCE(b.quantidade, 0)) AS m
    FROM itens i
    JOIN estoque_tecido_baixas b ON b.oc_tecido_item_id = i.id AND b.origem <> 'separacao_rolo'
    WHERE i.status = 'recebido'
    GROUP BY i.variante_tecido_id
  ),
  os_baixa AS (
    SELECT oi.variante_tecido_id, SUM(COALESCE(oi.baixa, 0)) AS m
    FROM ordens_saida_tecido_itens oi
    JOIN ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND os.baixado
    WHERE oi.variante_tecido_id IS NOT NULL
    GROUP BY oi.variante_tecido_id
  ),
  os_reserva AS (
    SELECT oi.variante_tecido_id, SUM(COALESCE(oi.reserva, 0)) AS m
    FROM ordens_saida_tecido_itens oi
    JOIN ordens_saida_tecido os ON os.id = oi.ordem_saida_id AND os.tenant_id = _tenant AND NOT os.baixado
    WHERE oi.variante_tecido_id IS NOT NULL
    GROUP BY oi.variante_tecido_id
  ),
  grade AS (
    SELECT modelo_id, variante_numero, SUM(COALESCE(grade_total, 0)) AS gt
    FROM modelo_grades WHERE variante_numero IS NOT NULL
    GROUP BY modelo_id, variante_numero
  ),
  reserva_mod AS (
    SELECT mv.variante_tecido_id,
           SUM(COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
               * CASE
                   WHEN mt.tipo = 'tecido' AND mt.numero = 1 THEN COALESCE(g.gt,0)
                   WHEN mv.complementa_variante_ids IS NOT NULL AND cardinality(mv.complementa_variante_ids) > 0
                     THEN public._grade_soma_pares(mt.modelo_id, mv.complementa_variante_ids)
                   ELSE COALESCE(g.gt,0)   -- complementar SEM casamento = comportamento de hoje
                 END
               * COALESCE(mv.multiplicador,1)) AS m
    FROM modelo_tecido_variantes mv
    JOIN modelo_tecidos mt ON mt.id = mv.modelo_tecido_id
    JOIN modelos m ON m.id = mt.modelo_id AND m.tenant_id = _tenant
      AND lower(COALESCE(m.status_desenvolvimento,'')) <> 'reprovado'
      AND NOT EXISTS (SELECT 1 FROM cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
    LEFT JOIN grade g ON g.modelo_id = mt.modelo_id AND g.variante_numero = mv.ordem
    WHERE mv.variante_tecido_id IS NOT NULL
    GROUP BY mv.variante_tecido_id
  ),
  agg AS (
    SELECT v.id AS variante_tecido_id, v.artigo_id,
           COALESCE(prev.m, 0) AS prev_receb_m,
           COALESCE(receb.m, 0) - COALESCE(sep.m, 0) AS recebido_m,
           COALESCE(bl.m, 0) + COALESCE(ob.m, 0) AS baixa,
           COALESCE(rm.m, 0) + COALESCE(orr.m, 0) AS reservado
    FROM variantes_tecido v
    JOIN artigos a ON a.id = v.artigo_id AND a.tenant_id = _tenant
    LEFT JOIN prev ON prev.variante_tecido_id = v.id
    LEFT JOIN receb ON receb.variante_tecido_id = v.id
    LEFT JOIN separado sep ON sep.variante_tecido_id = v.id
    LEFT JOIN baixa_led bl ON bl.variante_tecido_id = v.id
    LEFT JOIN os_baixa ob ON ob.variante_tecido_id = v.id
    LEFT JOIN os_reserva orr ON orr.variante_tecido_id = v.id
    LEFT JOIN reserva_mod rm ON rm.variante_tecido_id = v.id
  )
  SELECT agg.variante_tecido_id, agg.artigo_id, agg.prev_receb_m, agg.recebido_m, agg.baixa, agg.reservado,
         GREATEST(0, agg.recebido_m - agg.baixa) AS fisico,
         GREATEST(0, agg.recebido_m - agg.baixa) + agg.prev_receb_m - agg.reservado AS previsto
  FROM agg
$function$;

-- PRE-CONDICAO: texto novo x texto de antes, variante a variante (todas as lojas)
CREATE TEMP TABLE _r15_core_depois ON COMMIT DROP AS
  SELECT t.id AS tenant_id, t.nome::text AS loja, c.*
    FROM public.tenants t CROSS JOIN LATERAL public._estoque_tecido_core(t.id) c;

DO $precondicao$
DECLARE
  r record;
  v_n int;
  v_dif int := 0;
  v_esp record;
BEGIN
  SELECT count(*) INTO v_n FROM _r15_core_antes;
  IF v_n <> (SELECT count(*) FROM _r15_core_depois) THEN
    RAISE EXCEPTION 'medios_r15a: pre-condicao - numero de variantes mudou (% x %)', v_n, (SELECT count(*) FROM _r15_core_depois)
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT COALESCE(a.loja, d.loja) AS loja, COALESCE(a.variante_tecido_id, d.variante_tecido_id) AS vid,
           a.prev_receb_m AS prev_a, d.prev_receb_m AS prev_d, a.reservado AS res_a, d.reservado AS res_d,
           a.recebido_m AS rec_a, d.recebido_m AS rec_d, a.baixa AS bx_a, d.baixa AS bx_d,
           a.fisico AS fis_a, d.fisico AS fis_d, a.previsto AS pv_a, d.previsto AS pv_d
      FROM _r15_core_antes a
      FULL JOIN _r15_core_depois d ON d.tenant_id = a.tenant_id AND d.variante_tecido_id = a.variante_tecido_id
     WHERE (a.prev_receb_m, a.reservado, a.recebido_m, a.baixa, a.fisico, a.previsto)
           IS DISTINCT FROM (d.prev_receb_m, d.reservado, d.recebido_m, d.baixa, d.fisico, d.previsto)
     ORDER BY 1, 2
  LOOP
    v_dif := v_dif + 1;
    RAISE NOTICE 'medios_r15a: % : % recebido %>% baixa %>% fisico %>% previsto %>%', r.loja, left(r.vid::text, 8),
      round(r.rec_a, 4), round(r.rec_d, 4), round(r.bx_a, 4), round(r.bx_d, 4), round(r.fis_a, 4), round(r.fis_d, 4),
      round(r.pv_a, 4), round(r.pv_d, 4);
    IF r.prev_a IS DISTINCT FROM r.prev_d OR r.res_a IS DISTINCT FROM r.res_d THEN
      RAISE EXCEPTION 'medios_r15a: pre-condicao - a receber/reservado mudou em %:% (nao devia)', r.loja, left(r.vid::text, 8)
        USING ERRCODE = 'P0001';
    END IF;
    IF r.fis_a IS DISTINCT FROM r.fis_d OR r.pv_a IS DISTINCT FROM r.pv_d THEN
      SELECT * INTO v_esp FROM _r15_esperados e WHERE e.loja = r.loja AND e.variante8 = left(r.vid::text, 8);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'medios_r15a: pre-condicao - fisico de %:% mudou (% > %) e a variante nao esta na lista esperada',
          r.loja, left(r.vid::text, 8), round(r.fis_a, 4), round(r.fis_d, 4) USING ERRCODE = 'P0001';
      END IF;
      IF abs((r.fis_d - r.fis_a) - v_esp.delta_fisico) > 0.001 THEN
        RAISE EXCEPTION 'medios_r15a: pre-condicao - delta do fisico de %:% = % (esperado %)',
          r.loja, left(r.vid::text, 8), round(r.fis_d - r.fis_a, 4), v_esp.delta_fisico USING ERRCODE = 'P0001';
      END IF;
      IF abs((r.pv_d - r.pv_a) - (r.fis_d - r.fis_a)) > 0.001 THEN
        RAISE EXCEPTION 'medios_r15a: pre-condicao - previsto de %:% mudou diferente do fisico', r.loja, left(r.vid::text, 8)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
    IF (r.rec_a IS DISTINCT FROM r.rec_d OR r.bx_a IS DISTINCT FROM r.bx_d)
       AND NOT EXISTS (SELECT 1 FROM public.ocs_tecido_itens it
                        WHERE it.variante_tecido_id = r.vid
                          AND (EXISTS (SELECT 1 FROM public.ocs_tecido ro WHERE ro.is_rolo AND ro.rolo_origem_item_id = it.id)
                               OR EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b
                                           WHERE b.oc_tecido_item_id = it.id AND b.origem = 'separacao_rolo'))) THEN
      RAISE EXCEPTION 'medios_r15a: pre-condicao - recebido/baixa de %:% mudou sem item de origem de rolo', r.loja, left(r.vid::text, 8)
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RAISE NOTICE 'medios_r15a: pre-condicao OK - % variantes conferidas, % mudaram (lista acima)', v_n, v_dif;
END $precondicao$;

CREATE OR REPLACE FUNCTION public.detalhe_estoque_variante(_variante_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R15 est #2 + est #4] Painel "Estoque por OC" de UMA variante com a MESMA regra do core (_estoque_tecido_core):
--   * linhas = itens nao cancelados de OC recebida/encomendada da loja (o item de ORIGEM de rolo agora aparece);
--   * recebido_m = (OC recebida) recebida, senao a pedida (0 se troca), kg->m, MENOS a separacao de rolo do item
--     (transferencia para o rolo); baixado_m = (OC recebida) baixas do ledger do item fora a separacao; prev_receb_m =
--     (OC encomendada) pedida kg->m. Sigma das linhas = recebido/baixa/a receber do core (fora as baixas de OS, que
--     nao tem item);
--   * reservado_m = a reserva do core (cards nao reprovados e ainda nao enviados ao corte - libera com enviado_corte)
--     REPARTIDA entre os vinculos do card (modelo_tecido_oc_links) na ordem do corte: prioridade, depois
--     oc_tecido_item_id; cada vinculo leva min(restante, quantidade_m se > 0) e o ULTIMO leva o resto (mesma regua de
--     repartirDemanda / Situacao por OC, P-168 A). Card sem vinculo nesta variante nao entra em linha nenhuma: o front
--     mostra "Reserva sem OC" = reservado do core - Sigma das linhas (>= 0 por construcao).
-- Formato da resposta (chaves e ordem) igual ao de antes.
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
BEGIN
  WITH linhas AS (
    SELECT
      it.id, oc.id AS oc_id, oc.numero_pedido, COALESCE(oc.is_rolo, false) AS is_rolo, oc.rolo_codigo,
      COALESCE(oc.data_entrega, oc.data_prevista_entrega) AS data_entrega, oc.created_at,
      e.nome_fantasia AS fornecedor,
      (oc.status = 'recebido') AS recebida,
      CASE WHEN oc.status <> 'encomendado' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_pedida,0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_pedida,0) END AS prev_receb_m,
      CASE WHEN oc.status <> 'recebido' THEN 0
           WHEN a.unidade_medida = 'kg' THEN COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) * COALESCE(a.rendimento,0)
           ELSE COALESCE(it.quantidade_recebida, CASE WHEN it.substitui_item_id IS NOT NULL THEN 0 ELSE it.quantidade_pedida END, 0) END
      - CASE WHEN oc.status <> 'recebido' THEN 0
             ELSE COALESCE((SELECT SUM(b.quantidade) FROM public.estoque_tecido_baixas b
                             WHERE b.oc_tecido_item_id = it.id AND b.origem = 'separacao_rolo'), 0) END AS recebido_m,
      CASE WHEN oc.status <> 'recebido' THEN 0
           ELSE COALESCE((SELECT SUM(b.quantidade) FROM public.estoque_tecido_baixas b
                           WHERE b.oc_tecido_item_id = it.id AND b.origem <> 'separacao_rolo'), 0) END AS baixado_m
    FROM public.ocs_tecido_itens it
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
    LEFT JOIN public.empresas e ON e.id = oc.empresa_id
    LEFT JOIN public.artigos a ON a.id = it.artigo_id
    WHERE oc.tenant_id = v_tenant
      AND oc.status IN ('recebido', 'encomendado')
      AND COALESCE(it.cancelado, false) = false
      AND it.variante_tecido_id = _variante_id
  ),
  grade AS (
    SELECT modelo_id, variante_numero, SUM(COALESCE(grade_total, 0)) AS gt
    FROM public.modelo_grades WHERE variante_numero IS NOT NULL
    GROUP BY modelo_id, variante_numero
  ),
  parcelas AS (
    -- a MESMA parcela da reserva_mod do core, so desta variante
    SELECT mv.id AS pid, mt.modelo_id, mt.tipo, mt.numero, mv.ordem,
           COALESCE(mt.consumo,0) * (1 + COALESCE(mt.loss_percent,0)/100.0)
           * CASE
               WHEN mt.tipo = 'tecido' AND mt.numero = 1 THEN COALESCE(g.gt,0)
               WHEN mv.complementa_variante_ids IS NOT NULL AND cardinality(mv.complementa_variante_ids) > 0
                 THEN public._grade_soma_pares(mt.modelo_id, mv.complementa_variante_ids)
               ELSE COALESCE(g.gt,0)
             END
           * COALESCE(mv.multiplicador,1) AS metros
    FROM public.modelo_tecido_variantes mv
    JOIN public.modelo_tecidos mt ON mt.id = mv.modelo_tecido_id
    JOIN public.modelos m ON m.id = mt.modelo_id AND m.tenant_id = v_tenant
      AND lower(COALESCE(m.status_desenvolvimento,'')) <> 'reprovado'
      AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte)
    LEFT JOIN grade g ON g.modelo_id = mt.modelo_id AND g.variante_numero = mv.ordem
    WHERE mv.variante_tecido_id = _variante_id
  ),
  cands AS (
    SELECT p.pid, p.metros, l.oc_tecido_item_id AS item_id, COALESCE(l.quantidade_m, 0) AS q,
           row_number() OVER (PARTITION BY p.pid ORDER BY l.prioridade, l.oc_tecido_item_id) AS rn,
           count(*) OVER (PARTITION BY p.pid) AS n
    FROM parcelas p
    JOIN public.modelo_tecido_oc_links l
      ON l.modelo_id = p.modelo_id AND l.tipo = p.tipo AND l.numero = p.numero AND l.ordem = p.ordem
     AND l.variante_tecido_id = _variante_id
    WHERE l.oc_tecido_item_id IN (SELECT id FROM linhas)
  ),
  limites AS (
    -- NULL = sem teto (vinculo com quantidade_m 0, ou o ULTIMO da parcela, que leva o resto)
    SELECT pid, metros, item_id, rn, CASE WHEN rn = n THEN NULL WHEN q > 0 THEN q ELSE NULL END AS teto
    FROM cands
  ),
  partes AS (
    SELECT item_id,
           CASE WHEN bool_or(teto IS NULL) OVER antes THEN 0
                ELSE GREATEST(0, LEAST(COALESCE(teto, metros), metros - COALESCE(sum(teto) OVER antes, 0)))
           END AS m
    FROM limites
    WINDOW antes AS (PARTITION BY pid ORDER BY rn ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
  ),
  reserva AS (
    SELECT item_id, SUM(m) AS m FROM partes GROUP BY item_id
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY recebida DESC, data_entrega NULLS LAST, created_at), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      li.id AS oc_tecido_item_id,
      li.oc_id,
      li.numero_pedido,
      li.is_rolo,
      li.rolo_codigo,
      li.data_entrega,
      li.created_at,
      li.fornecedor,
      li.recebida,
      li.prev_receb_m,
      li.recebido_m,
      li.baixado_m,
      COALESCE(r.m, 0) AS reservado_m
    FROM linhas li
    LEFT JOIN reserva r ON r.item_id = li.id
  ) t;
  RETURN v_result;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r15a_md5_aceitos WHERE papel IN ('depois','leitor') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r15a: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: o core segue sem EXECUTE para PUBLIC/anon/authenticated; o painel sem anon/PUBLIC
  FOR r IN SELECT * FROM (VALUES ('public._estoque_tecido_core(uuid)', true), ('public.detalhe_estoque_variante(uuid)', false)) v(s, core) LOOP
    IF has_function_privilege('anon', r.s, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15a: % ficou executavel por anon', r.s USING ERRCODE = 'P0001';
    END IF;
    IF r.core AND has_function_privilege('authenticated', r.s, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15a: % ficou executavel por authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF NOT r.core AND NOT has_function_privilege('authenticated', r.s, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15a: % perdeu o EXECUTE de authenticated (a tela usa)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r15a: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
