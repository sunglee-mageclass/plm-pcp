-- Contas certas A2 - CORRECAO UNICA (P-166 A, parte 2): congela o valor das parcelas de SERVICO ja PAGAS com o valor
-- que a tela mostrava (a formula antiga de servicos_financeiro: liquido / n_eff, a ultima leva o resto). Depende da
-- 20261019210000 (coluna valor_pago + gatilho) ja aplicada.
--
-- Contagem ESPERADA = Passo 0.4 em PRODUCAO (somente leitura, 30/set 11:22, passo0-0.4-servico-pagas-2026-09-30-112215.csv):
--   1 parcela paga: 7cc37d10-a89d-4fe5-9c18-9333303d854d (Loja Teste, bloco a2881d14, nº 1 de 1, paga 20/08,
--   9,00 x 192 = 1.728,00) e 0 edicoes de preco/qtd/desconto/multa/nº de parcelas DEPOIS do pagamento (pre-condicao:
--   so assim "o valor da tela hoje" e o valor pago). A copia local tem a MESMA (prova em transacao revertida).
-- Regras (RA3):
--   * so roda com, na MESMA sessao e ANTES do arquivo: SET app.confirmo_correcao_contas_certas_a2 = 'sim';
--   * trava parcelas_servico e producao_terceirizados (SHARE ROW EXCLUSIVE: leitura segue, escrita espera o COMMIT),
--     reconfere a lista e a pre-condicao (0 edicoes depois do pagamento) contra o Passo 0 -> divergiu: P0001, nada muda;
--   * liga a GUC de transacao app.servico_valor_pago_correcao = 'on' (o gatilho trg_servico_parcela_valor_pago deixa
--     esta correcao gravar o valor; so nesta transacao);
--   * guarda a lista (id + valor gravado) em public._bkp_cc_a2_valor_pago para a volta;
--   * auditada: o UPDATE passa pelo audit_parcelas_servico (fn_audit grava "valor_pago: null -> 1728.00", autor Sistema).
-- Idempotente: parcela com valor_pago ja preenchido nao e contada de novo nem regravada.
-- Volta: supabase/rollback/20261019210100_servico_valor_pago_correcao_down.sql. LIFO: antes da volta da 20261019210000.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TABLE IF NOT EXISTS public._bkp_cc_a2_valor_pago (
  parcela_id  uuid          PRIMARY KEY,
  valor_pago  numeric(12,2) NOT NULL,
  gravado_em  timestamptz   NOT NULL DEFAULT now()
);
ALTER TABLE public._bkp_cc_a2_valor_pago ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_cc_a2_valor_pago FROM PUBLIC, anon, authenticated;

-- >>> CORPO DA CORRECAO (o mesmo bloco e executado na prova da copia, dentro de BEGIN...ROLLBACK)
DO $correcao$
DECLARE
  -- Passo 0.4 (producao, 30/set 11:22)
  v_contagem_esperada constant int := 1;
  v_esperados constant uuid[] := ARRAY['7cc37d10-a89d-4fe5-9c18-9333303d854d']::uuid[];
  v_cand uuid[];
  v_editadas uuid[];
  v_n int;
BEGIN
  IF COALESCE(current_setting('app.confirmo_correcao_contas_certas_a2', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'contas_certas_a2_correcao: falta SET app.confirmo_correcao_contas_certas_a2 = sim - nada foi gravado'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parcelas_servico'
                 AND column_name = 'valor_pago') THEN
    RAISE EXCEPTION 'contas_certas_a2_correcao: parcelas_servico.valor_pago nao existe - aplicar a 20261019210000 antes' USING ERRCODE = 'P0001';
  END IF;

  LOCK TABLE public.parcelas_servico IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.producao_terceirizados IN SHARE ROW EXCLUSIVE MODE;

  -- candidatas: PAGAS ainda sem valor congelado
  SELECT array_agg(ps.id ORDER BY ps.id) INTO v_cand
    FROM public.parcelas_servico ps
   WHERE (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL) AND ps.valor_pago IS NULL;
  IF (SELECT count(*) FROM unnest(COALESCE(v_cand, '{}'::uuid[])) x WHERE NOT (x = ANY (v_esperados))) > 0 THEN
    RAISE EXCEPTION 'contas_certas_a2_correcao: parcela(s) paga(s) fora da lista do Passo 0: % - rodar o Passo 0.4 de novo; nada foi gravado',
      (SELECT array_agg(x) FROM unnest(v_cand) x WHERE NOT (x = ANY (v_esperados))) USING ERRCODE = 'P0001';
  END IF;
  -- as da lista: ou ainda candidatas, ou ja congeladas (execucao anterior); nunca "voltou a nao paga" / apagada
  IF (SELECT count(*) FROM public.parcelas_servico ps WHERE ps.id = ANY (v_esperados)
        AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)) <> v_contagem_esperada
     OR cardinality(v_esperados) <> v_contagem_esperada THEN
    RAISE EXCEPTION 'contas_certas_a2_correcao: contagem diferente da esperada (%) - rodar o Passo 0.4 de novo; nada foi gravado', v_contagem_esperada
      USING ERRCODE = 'P0001';
  END IF;
  -- pre-condicao do Passo 0.4: nenhuma edicao de preco/qtd/desconto/multa/nº de parcelas do bloco DEPOIS do pagamento
  SELECT array_agg(pg.id) INTO v_editadas
    FROM (SELECT ps.id, ps.producao_terceirizado_id AS pt_id,
                 COALESCE((SELECT min(a.created_at) FROM public.audit_log a
                            WHERE a.tabela = 'parcelas_servico' AND a.registro_id = ps.id
                              AND (a.dados -> 'status' ->> 'para' = 'pago' OR a.dados -> 'data_pagamento' ->> 'para' IS NOT NULL)),
                          ps.data_pagamento::timestamptz) AS pago_em
            FROM public.parcelas_servico ps
           WHERE ps.id = ANY (COALESCE(v_cand, '{}'::uuid[]))) pg
   WHERE EXISTS (SELECT 1 FROM public.audit_log a
                  WHERE a.tabela = 'producao_terceirizados' AND a.acao = 'editar' AND a.registro_id = pg.pt_id
                    AND a.created_at > pg.pago_em
                    AND a.dados ?| array['preco_metro_unidade','quantidade_enviada','desconto_total','multa_total','numero_parcelas']);
  IF v_editadas IS NOT NULL THEN
    RAISE EXCEPTION 'contas_certas_a2_correcao: bloco editado DEPOIS do pagamento nas parcelas % - o valor da tela nao e o valor pago; vira pergunta ao dono; nada foi gravado', v_editadas
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.servico_valor_pago_correcao', 'on', true);

  -- valor da tela de antes (formula antiga de servicos_financeiro 20260824150000)
  WITH calc AS (
    SELECT ps.id,
           round(CASE WHEN ps.numero_parcela >= x.n_eff
                      THEN x.liq - round(x.liq / x.n_eff, 2) * (x.n_eff - 1)
                      ELSE round(x.liq / x.n_eff, 2) END, 2) AS valor
      FROM public.parcelas_servico ps
      JOIN public.producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
      LEFT JOIN public.empresas emp ON emp.id = pt.empresa_id
      CROSS JOIN LATERAL (SELECT
          (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) AS liq,
          LEAST(GREATEST(
            COALESCE(NULLIF(array_length(ARRAY(SELECT 1 FROM regexp_split_to_table(COALESCE(emp.prazo_pagamento,''),'[^0-9]+') AS t WHERE t ~ '^[0-9]+$'),1),0),
                     GREATEST(COALESCE(pt.numero_parcelas,1),1)),
          1), 24) AS n_eff) x
     WHERE ps.id = ANY (COALESCE(v_cand, '{}'::uuid[]))
  ), bkp AS (
    INSERT INTO public._bkp_cc_a2_valor_pago (parcela_id, valor_pago)
    SELECT c.id, c.valor FROM calc c
    ON CONFLICT (parcela_id) DO NOTHING
    RETURNING parcela_id
  )
  UPDATE public.parcelas_servico ps SET valor_pago = c.valor
    FROM calc c WHERE ps.id = c.id AND ps.valor_pago IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM set_config('app.servico_valor_pago_correcao', '', true);

  IF EXISTS (SELECT 1 FROM public.parcelas_servico ps WHERE ps.id = ANY (v_esperados) AND ps.valor_pago IS NULL) THEN
    RAISE EXCEPTION 'contas_certas_a2_correcao: pos-condicao falhou (sobrou parcela paga da lista sem valor_pago)' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'contas_certas_a2_correcao: % parcela(s) paga(s) com o valor congelado (lista do Passo 0: %)', v_n, cardinality(v_esperados);
END $correcao$;
-- <<< FIM DO CORPO

COMMIT;
