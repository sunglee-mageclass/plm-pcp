-- Contas certas A1 - CORRECAO UNICA (P-166 A, parte 1): marca como "ajustada a mao" (vencimento_manual = true) as
-- parcelas de OC NAO pagas cujo vencimento de hoje veio de uma edicao manual (a ultima edicao de data_vencimento no
-- audit_log ainda e a data vigente). Depende da 20261019200000 (coluna + gatilhos) ja aplicada.
-- As 2 datas ja perdidas da Loja Teste (2cb8f5b3, 2d2b73a6 - apagadas pelo save da OC em 07/07) NAO sao restauradas.
--
-- Contagem ESPERADA = Passo 0.3 em PRODUCAO (somente leitura, 30/set 11:22, passo0-0.3-vencimento-manual-2026-09-30-112215.csv):
--   1 parcela: bb5624bd-305c-42fe-ab18-8e468b35141c (Loja Teste, aviamento, nº 1, vencimento 2026-07-20, editada 01/07).
--   A copia local tem a MESMA (prova na copia feita em transacao revertida).
-- Regras da correcao (RA3):
--   * so roda com, na MESMA sessao e ANTES do arquivo: SET app.confirmo_correcao_contas_certas_a1 = 'sim';
--     (sem isso: P0001 e nada muda - um `psql -f` solto de todas as migrations nao aplica correcao de dado);
--   * trava parcelas (SHARE ROW EXCLUSIVE: leitura segue, escrita espera o COMMIT) e reconfere a lista contra a do
--     Passo 0: parcela FORA da lista (sem a marca) ou parcela da lista que ja nao se encaixa -> P0001 e nada muda;
--   * guarda a lista (id + vencimento no momento) em public._bkp_cc_a1_vencimento_manual para a volta;
--   * auditada: o UPDATE passa pelo audit_parcelas (fn_audit grava "vencimento_manual: false -> true", autor Sistema).
-- Idempotente: parcela ja marcada (pelo gatilho ou por uma 1a execucao) nao e contada de novo nem regravada.
-- Volta: supabase/rollback/20261019200100_parcelas_vencimento_manual_correcao_down.sql (desmarca SO as da lista cujo
-- vencimento nao mudou desde a correcao). LIFO: vem ANTES da volta da 20261019200000.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TABLE IF NOT EXISTS public._bkp_cc_a1_vencimento_manual (
  parcela_id      uuid        PRIMARY KEY,
  data_vencimento date        NOT NULL,
  marcado_em      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._bkp_cc_a1_vencimento_manual ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_cc_a1_vencimento_manual FROM PUBLIC, anon, authenticated;

-- >>> CORPO DA CORRECAO (o mesmo bloco e executado na prova da copia, dentro de BEGIN...ROLLBACK)
DO $correcao$
DECLARE
  -- Passo 0.3 (producao, 30/set 11:22)
  v_contagem_esperada constant int := 1;
  v_esperados constant uuid[] := ARRAY['bb5624bd-305c-42fe-ab18-8e468b35141c']::uuid[];
  v_cand uuid[];
  v_fora uuid[];
  v_falta uuid[];
  v_n int;
BEGIN
  IF COALESCE(current_setting('app.confirmo_correcao_contas_certas_a1', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'contas_certas_a1_correcao: falta SET app.confirmo_correcao_contas_certas_a1 = sim - nada foi marcado'
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parcelas'
                 AND column_name = 'vencimento_manual') THEN
    RAISE EXCEPTION 'contas_certas_a1_correcao: parcelas.vencimento_manual nao existe - aplicar a 20261019200000 antes' USING ERRCODE = 'P0001';
  END IF;

  LOCK TABLE public.parcelas IN SHARE ROW EXCLUSIVE MODE;

  -- candidatas = a MESMA consulta do Passo 0.3: nao paga e com o vencimento = o "para" da ULTIMA edicao manual
  SELECT array_agg(p.id ORDER BY p.id) INTO v_cand
    FROM public.parcelas p
    JOIN (SELECT DISTINCT ON (registro_id) registro_id, (dados -> 'data_vencimento' ->> 'para')::date AS para
            FROM public.audit_log
           WHERE tabela = 'parcelas' AND acao = 'editar' AND dados ? 'data_vencimento'
             AND (dados -> 'data_vencimento' ->> 'para') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           ORDER BY registro_id, created_at DESC) a ON a.registro_id = p.id
   WHERE p.data_vencimento = a.para AND p.data_pagamento IS NULL AND p.status IS DISTINCT FROM 'pago';

  -- fora da lista do Passo 0 E ainda sem a marca (editada depois do Passo 0 e antes da 20261019200000?) -> para
  SELECT array_agg(x ORDER BY x) INTO v_fora
    FROM unnest(COALESCE(v_cand, '{}'::uuid[])) x
   WHERE NOT (x = ANY (v_esperados))
     AND NOT (SELECT p.vencimento_manual FROM public.parcelas p WHERE p.id = x);
  IF v_fora IS NOT NULL THEN
    RAISE EXCEPTION 'contas_certas_a1_correcao: parcela(s) fora da lista do Passo 0: % - rodar o Passo 0.3 de novo; nada foi marcado', v_fora
      USING ERRCODE = 'P0001';
  END IF;
  -- da lista do Passo 0 que ja nao se encaixa (paga, apagada, data mudou) -> para
  SELECT array_agg(x ORDER BY x) INTO v_falta
    FROM unnest(v_esperados) x
   WHERE NOT (x = ANY (COALESCE(v_cand, '{}'::uuid[])));
  IF v_falta IS NOT NULL THEN
    RAISE EXCEPTION 'contas_certas_a1_correcao: parcela(s) do Passo 0 que ja nao se encaixam: % - rodar o Passo 0.3 de novo; nada foi marcado', v_falta
      USING ERRCODE = 'P0001';
  END IF;

  IF cardinality(v_esperados) <> v_contagem_esperada
     OR (SELECT count(*) FROM unnest(v_cand) x WHERE x = ANY (v_esperados)) <> v_contagem_esperada THEN
    RAISE EXCEPTION 'contas_certas_a1_correcao: contagem diferente da esperada (%) - nada foi marcado', v_contagem_esperada USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public._bkp_cc_a1_vencimento_manual (parcela_id, data_vencimento)
  SELECT p.id, p.data_vencimento FROM public.parcelas p
   WHERE p.id = ANY (v_esperados) AND NOT p.vencimento_manual
  ON CONFLICT (parcela_id) DO NOTHING;

  UPDATE public.parcelas p SET vencimento_manual = true
   WHERE p.id = ANY (v_esperados) AND NOT p.vencimento_manual;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM public.parcelas p WHERE p.id = ANY (v_esperados) AND NOT p.vencimento_manual) THEN
    RAISE EXCEPTION 'contas_certas_a1_correcao: pos-condicao falhou (sobrou parcela da lista sem a marca)' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'contas_certas_a1_correcao: % parcela(s) marcada(s) como ajustada(s) a mao (lista do Passo 0: %)', v_n, cardinality(v_esperados);
END $correcao$;
-- <<< FIM DO CORPO

COMMIT;
