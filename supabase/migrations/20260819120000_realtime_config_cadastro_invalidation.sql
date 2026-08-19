-- 20260819120000_realtime_config_cadastro_invalidation.sql
-- Atualização AO VIVO entre usuários (item 11 do dono) — infra de Realtime para o hook
-- global `useRealtimeInvalidation`. Adiciona as tabelas de CONFIG + CADASTRO (low-churn,
-- que alimentam dropdowns/regras) à publication `supabase_realtime`, para que um save de
-- um usuário dispare postgres_changes na tela de outro usuário do mesmo tenant.
--
-- TENANT-SCOPE: postgres_changes respeita a RLS de SELECT — todas as 11 tabelas já têm
-- policy `tenant_id = get_user_tenant_id()` (verificado), então cada usuário só recebe
-- eventos do próprio tenant. NÃO há vazamento cross-tenant.
--
-- REPLICA IDENTITY FULL: sem a linha inteira no WAL de um DELETE, o apply_rls do Realtime
-- não consegue avaliar `tenant_id = get_user_tenant_id()` (a PK sozinha não tem tenant_id)
-- e DESCARTA o evento — então excluir uma cor / linha / loja de direcionamento não
-- propagaria. FULL manda a linha antiga completa e o DELETE passa a chegar. Mesma razão do
-- colab hardening 20260807130000 (item 2). Tabelas pequenas/low-churn ⇒ custo de WAL
-- desprezível.
--
-- Idempotente: guarda contra re-ADD na publication; ALTER ... REPLICA IDENTITY é sempre
-- seguro reaplicar.

DO $$
DECLARE
  t text;
  alvos text[] := ARRAY[
    'tenant_config',
    'categorias_produto',
    'subcategorias1_produto',
    'subcategorias2_produto',
    'grupos_produto',
    'linhas',
    'meses',
    'cores',
    'cores_apelido',
    'categorias_terceirizado',
    'lojas_direcionamento'
  ];
BEGIN
  FOREACH t IN ARRAY alvos LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;
