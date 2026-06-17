-- Bug: upload de logo/favicon do SISTEMA falhava porque o bucket
-- 'system-identity' nunca foi criado no banco novo (as policies já existiam).
INSERT INTO storage.buckets (id, name, public)
VALUES ('system-identity', 'system-identity', false)
ON CONFLICT (id) DO NOTHING;

-- Bug: logo da LOJA (bucket tenant-logos) era gravada na raiz (sem pasta de
-- tenant), e a única policy de leitura exigia (foldername)[1] = tenant_id —
-- então o super_admin (que gerencia as lojas) nunca conseguia ler a logo.
-- Adiciona leitura para super_admin.
DROP POLICY IF EXISTS tenant_logos_super_admin_read ON storage.objects;
CREATE POLICY tenant_logos_super_admin_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'tenant-logos' AND public.is_super_admin());
