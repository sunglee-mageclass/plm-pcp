-- INVERSO de supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql (achados LEVES L9, fin #8, P-206 A).
-- Devolve NULL (= "vale o preco do cadastro", o comportamento de antes) nos itens que a correcao congelou, SO onde o preco
-- AINDA e o congelado (public._bkp_l9_preco_congelado.preco_depois). Preco editado depois na tela fica (contado no NOTICE).
-- Efeitos (caminho normal, nenhum gatilho desligado): OC de aviamento RECEBIDA -> parcelas nao pagas recalculadas pelo
-- cadastro de hoje (mesmo valor, se o cadastro nao mudou); item de tecido -> fila de custo dos modelos nao cortados
-- vinculados (o preco do tecido volta a vir do cadastro). A tabela de backup FICA (linhas marcadas revertido_em).
-- Idempotente: rodar de novo = 0 itens (no-op). Reaplicar a correcao depois = recongela o que estiver vazio.
-- LIFO: roda ANTES de supabase/rollback/20261029100000_oc_aviamento_preco_down.sql. Horario calmo (sobe o rev das OCs).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '30s';
SET LOCAL transaction_timeout = '60s';

DO $volta$
DECLARE
  v_avi integer := 0;
  v_tec integer := 0;
  v_fica integer := 0;
BEGIN
  IF to_regclass('public._bkp_l9_preco_congelado') IS NULL THEN
    RAISE NOTICE 'leves_l9 (correcao, volta): tabela de backup ausente - a correcao nunca rodou; nada a desfazer';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ocs_aviamento_itens'
                   AND column_name = 'preco') THEN
    RAISE EXCEPTION 'leves_l9 (correcao, volta): ocs_aviamento_itens.preco nao existe (o _down_drop ja rodou?) - nada a fazer aqui'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.ocs_aviamento_itens it
   WHERE it.id IN (SELECT b.item_id FROM public._bkp_l9_preco_congelado b WHERE b.tabela = 'ocs_aviamento_itens' AND b.revertido_em IS NULL)
   ORDER BY it.id FOR UPDATE;
  PERFORM 1 FROM public.ocs_tecido_itens it
   WHERE it.id IN (SELECT b.item_id FROM public._bkp_l9_preco_congelado b WHERE b.tabela = 'ocs_tecido_itens' AND b.revertido_em IS NULL)
   ORDER BY it.id FOR UPDATE;

  SELECT count(*) INTO v_fica
    FROM public._bkp_l9_preco_congelado b
    LEFT JOIN public.ocs_aviamento_itens ia ON b.tabela = 'ocs_aviamento_itens' AND ia.id = b.item_id
    LEFT JOIN public.ocs_tecido_itens it ON b.tabela = 'ocs_tecido_itens' AND it.id = b.item_id
   WHERE b.revertido_em IS NULL
     AND COALESCE(ia.preco, it.preco) IS DISTINCT FROM b.preco_depois;

  UPDATE public.ocs_aviamento_itens it SET preco = NULL
    FROM public._bkp_l9_preco_congelado b
   WHERE b.tabela = 'ocs_aviamento_itens' AND b.item_id = it.id AND b.revertido_em IS NULL AND it.preco = b.preco_depois;
  GET DIAGNOSTICS v_avi = ROW_COUNT;
  UPDATE public.ocs_tecido_itens it SET preco = NULL
    FROM public._bkp_l9_preco_congelado b
   WHERE b.tabela = 'ocs_tecido_itens' AND b.item_id = it.id AND b.revertido_em IS NULL AND it.preco = b.preco_depois;
  GET DIAGNOSTICS v_tec = ROW_COUNT;

  UPDATE public._bkp_l9_preco_congelado SET revertido_em = now() WHERE revertido_em IS NULL;

  RAISE NOTICE 'leves_l9 (correcao, volta): voltaram a vazio: aviamento %, tecido %; ficaram com o preco editado depois (ou item apagado): %',
    v_avi, v_tec, v_fica;
END $volta$;

COMMIT;
