-- 20261208100000_realtime_onda1_publicar_filhas.sql
-- Realtime Onda 1 ("ninguem mais aperta F5") - Task 2: publica no supabase_realtime as tabelas-FILHA que ainda
-- faltam, para a invalidacao de LISTA (useRealtimeInvalidation + realtime-invalidation-map.ts) refletir a edicao
-- de outra aba sem F5. Tambem publica producao_oficina (a Oficina usa `tabelasExtra: producao_oficina` no
-- useColabRegistro - Task 1 - e precisa da tabela publicada).
--
-- Tabelas (as 3 demais da onda - cad, variantes_aviamento, variantes_etiqueta - JA estao publicadas, nao mexe):
--   producao_oficina, tipos_colaborador, empresa_categorias_fornecedor, empresa_categorias_servico, enderecamento_tecido.
--
-- ADITIVO e idempotente: so faz ADD TABLE se a tabela ainda nao esta na publicacao.
-- REPLICA IDENTITY FULL (mesma razao da 20260819120000): o RLS de SELECT destas tabelas e `tenant_id = get_user_tenant_id()`
-- e o evento de DELETE so carrega a PK; sem a linha antiga completa o Realtime NAO consegue avaliar o tenant e DESCARTA o
-- DELETE (remover um endereco / tipo de colaborador numa aba nao propagaria). FULL so onde a PK NAO traz o tenant/empresa:
-- producao_oficina, tipos_colaborador, enderecamento_tecido (PK = id). empresa_categorias_* tem PK (empresa_id, categoria_id)
-- e a policy olha `empresas` por empresa_id (esta na PK) -> o DELETE ja chega com o default; nao se altera.
-- Trava: ALTER PUBLICATION ADD TABLE = ShareUpdateExclusive; REPLICA IDENTITY = AccessExclusive por milissegundos em 3 tabelas
-- pequenas (0-8 linhas). lock_timeout 1500ms: 55P03 = nada mudou (DO atomico), rodar de novo.
-- NAO e DDL de policy (nao toca auth/storage).
DO $$
DECLARE
  t text;
  alvos text[] := ARRAY['producao_oficina','tipos_colaborador','empresa_categorias_fornecedor','empresa_categorias_servico','enderecamento_tecido'];
  full_ident text[] := ARRAY['producao_oficina','tipos_colaborador','enderecamento_tecido'];
BEGIN
  PERFORM set_config('lock_timeout', '1500ms', true);
  FOREACH t IN ARRAY alvos LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY full_ident LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
  END LOOP;
END $$;
