-- INVERSO de supabase/migrations/20261019200000_parcelas_vencimento_manual.sql (contas certas A1, P-165 A, RA2).
-- DESLIGA os 4 gatilhos (ALTER TABLE ... DISABLE TRIGGER): as regeradoras voltam a recriar a parcela com a data calculada
-- (a data ajustada a mao volta a se perder no recalculo, como antes) e o UPDATE da data deixa de marcar vencimento_manual.
-- Por que DISABLE e nao DROP: no Supabase o DROP TRIGGER pega AccessExclusiveLock em ~23 tabelas de auth/storage/realtime
-- ate o COMMIT (supautils; medido na copia 30/set) - o DISABLE nao (so ShareRowExclusive em parcelas).
-- NAO apaga (RD1, "aposentar = ocultar primeiro"): a coluna parcelas.vencimento_manual (fica com o ultimo valor; nenhum
-- leitor muda comportamento por ela alem do icone do front), a tabela parcelas_vencimento_guardado (datas guardadas ficam
-- paradas) e as 4 funcoes. Reaplicar a migration religa os gatilhos.
-- Se a correcao unica (20261019200100) foi aplicada, desfaca-a ANTES (LIFO): supabase/rollback/20261019200100_*_down.sql.
-- Ordem geral: LIFO da APLICACAO. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
DECLARE
  r record;
  v_n int := 0;
BEGIN
  FOR r IN SELECT t.tgname, t.tgrelid::regclass AS tabela FROM pg_trigger t
            WHERE NOT t.tgisinternal
              AND ((t.tgrelid = 'public.parcelas'::regclass AND t.tgname IN ('trg_parcela_vencimento_manual',
                     'trg_parcela_vencimento_guarda', 'trg_parcela_vencimento_reaplica'))
                OR (to_regclass('public.parcelas_vencimento_guardado') IS NOT NULL
                    AND t.tgrelid = to_regclass('public.parcelas_vencimento_guardado')
                    AND t.tgname = 'trg_parcelas_vencimento_guardado_limpa')) LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', r.tabela, r.tgname);
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'contas_certas_a1 (volta): nenhum gatilho da 20261019200000 encontrado - nada a desfazer' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgenabled <> 'D'
              AND t.tgname IN ('trg_parcela_vencimento_manual', 'trg_parcela_vencimento_guarda',
                               'trg_parcela_vencimento_reaplica', 'trg_parcelas_vencimento_guardado_limpa')) THEN
    RAISE EXCEPTION 'contas_certas_a1 (volta): sobrou gatilho ligado' USING ERRCODE = 'P0001';
  END IF;
END $volta$;

NOTIFY pgrst, 'reload schema';
COMMIT;
