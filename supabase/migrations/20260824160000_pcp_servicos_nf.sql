BEGIN;

ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS nf_saida jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS nf_entrada jsonb NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public)
VALUES ('pcp-servicos', 'pcp-servicos', false)
ON CONFLICT (id) DO NOTHING;

-- pcp-servicos (tenant-scoped, mirrors 'comprovantes'/'oc-tecido' — idempotent via DROP IF EXISTS)
DROP POLICY IF EXISTS "pcp-servicos tenant select" ON storage.objects;
CREATE POLICY "pcp-servicos tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "pcp-servicos tenant insert" ON storage.objects;
CREATE POLICY "pcp-servicos tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "pcp-servicos tenant update" ON storage.objects;
CREATE POLICY "pcp-servicos tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

DROP POLICY IF EXISTS "pcp-servicos tenant delete" ON storage.objects;
CREATE POLICY "pcp-servicos tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pcp-servicos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

COMMIT;
