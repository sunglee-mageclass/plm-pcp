-- Volta da 20261208100000_realtime_onda1_publicar_filhas: tira as 5 tabelas da publicacao supabase_realtime
-- (guardado por IF EXISTS - idempotente) e devolve REPLICA IDENTITY DEFAULT nas 3 que a ida trocou para FULL.
-- Rodar com o SITE ja voltado (sem a publicacao o front novo so perde o "ao vivo", nada quebra). Nenhum dado muda.
DO $$
DECLARE
  t text;
  alvos text[] := ARRAY['producao_oficina','tipos_colaborador','empresa_categorias_fornecedor','empresa_categorias_servico','enderecamento_tecido'];
  full_ident text[] := ARRAY['producao_oficina','tipos_colaborador','enderecamento_tecido'];
BEGIN
  PERFORM set_config('lock_timeout', '1500ms', true);
  FOREACH t IN ARRAY alvos LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY full_ident LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY DEFAULT', t);
    END IF;
  END LOOP;
END $$;
