-- Realtime leve (Fase 2 do roadmap de colab universal) — grupo das OCs de compra.
-- Publica no Realtime as 5 raízes de OC + as 2 tabelas de produto (revenda/importado) que
-- alimentam as LISTAS dessas telas, para que a lista de outro usuário atualize sozinha quando
-- alguém cria/recebe/edita/exclui uma OC — sem F5. O mapeamento das queryKeys→tabela vive no
-- front (realtime-invalidation-map.ts); aqui só habilitamos a publicação + REPLICA IDENTITY FULL.
--
-- Todas as tabelas têm RLS `tenant_select` (tenant-scoped) — o postgres_changes respeita a policy
-- de SELECT, então cada usuário só recebe eventos do próprio tenant (as que têm `modgate_*` só
-- entregam a quem o módulo libera; realtime é leitura, não fura gate). Mesma dependência já em
-- produção nas 5 tabelas publicadas na Fase 1.
--
-- REPLICA IDENTITY FULL: p/ o evento de DELETE propagar a linha INTEIRA (não só a PK) e o
-- apply_rls do Realtime casar a policy de tenant no delete — senão excluir uma OC não atualizaria
-- a lista de quem está olhando (mesmo padrão de `20260807130000` p/ producao_terceirizados/CQ).
-- Idempotente (guards) p/ poder reaplicar.

BEGIN;

DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'ocs_aviamento', 'ocs_etiqueta', 'ocs_p_acabado', 'ocs_importado',
      'produtos_acabados', 'produtos_importados'
    ]) AS tbl
  LOOP
    -- REPLICA IDENTITY FULL (idempotente — setar de novo é no-op)
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', r.tbl);
    -- ADD TABLE à publicação só se ainda não estiver (ADD TABLE já publicado dá erro)
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
