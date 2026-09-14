-- Realtime leve (Fase 2) — Financeiro. Publica `parcelas` (a pagar/receber) e `parcelas_servico`
-- (serviços terceirizados) no Realtime, para que a lista de contas de outro usuário atualize
-- sozinha quando alguém dá baixa / muda vencimento / gera parcelas — sem F5. Concorrência real:
-- vários lançam pagamentos no mesmo período.
--
-- RLS: `parcelas` tem `tenant_select`; `parcelas_servico` tem `parcelas_servico_tenant` (+ o modgate
-- RESTRICTIVE do módulo financeiro, invariante #1) — ambas tenant-scoped, o postgres_changes respeita
-- o SELECT (sem vazamento cross-tenant; quem não tem o módulo não recebe evento). Mesma dependência já
-- em produção nas tabelas publicadas nas Fases 1/2.
--
-- REPLICA IDENTITY FULL: p/ o DELETE propagar a linha inteira e o apply_rls casar o tenant (ex.: uma
-- parcela removida ao recalcular deve sumir da lista de quem olha). Idempotente (guards).

BEGIN;

DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['parcelas', 'parcelas_servico']) AS tbl LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', r.tbl);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = r.tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', r.tbl);
    END IF;
  END LOOP;
END $mig$;

COMMIT;

SELECT pg_notify('pgrst', 'reload schema');
