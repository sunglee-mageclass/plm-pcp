-- APAGA a coluna ocs_aviamento_itens.preco (achados LEVES L9) - passo SEPARADO e OPCIONAL, depois do
-- 20261029100000_oc_aviamento_preco_down.sql.
-- ⚠ PERDE os precos da COMPRA digitados/congelados nas OCs de aviamento (inclusive os da correcao unica 20261029110000):
-- depois disto o valor de toda OC de aviamento volta a ser o preco do CADASTRO de hoje. So com decisao EXPLICITA do dono.
-- Antes: guardar os valores (ex.: \copy (select id, oc_aviamento_id, preco from ocs_aviamento_itens where preco is not null)
-- to 'l9-precos-oc-aviamento.csv' csv header) - o kit faz isso.
-- Guardas: (1) as 4 funcoes ja voltaram ao texto de ANTES (o _down rodou) - senao elas leriam uma coluna inexistente;
-- (2) SET app.confirmo_apagar_preco_oc_aviamento = 'sim' na sessao (o kit pede ao dono); (3) site antigo no ar.
-- Trava: DROP COLUMN = AccessExclusive curto em ocs_aviamento_itens (horario calmo; lock_timeout 500ms, o kit tenta 3x).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -c "SET app.confirmo_apagar_preco_oc_aviamento='sim'" -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
BEGIN
  IF coalesce(current_setting('app.confirmo_apagar_preco_oc_aviamento', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'leves_l9 (drop): falta SET app.confirmo_apagar_preco_oc_aviamento = sim (apaga os precos da compra)'
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.gerar_parcelas_oc_aviamento()', 'e98640190802afd6de9f82ac4ecb39c3'),
      ('public._recalcular_parcelas_core(uuid,text)', '3dcb59e6958c89d2d06901c50af390d7'),
      ('public._dashboard_financeiro_core(date,date)', '49b55c7be514483ced274ed05178a430'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', '3c5a3d108d7f6e5a37319ceccb4406e2')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL OR md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l9 (drop): % nao esta com o texto de antes - rode o _down antes deste', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

ALTER TABLE public.ocs_aviamento_itens DROP COLUMN IF EXISTS preco;

NOTIFY pgrst, 'reload schema';
COMMIT;
