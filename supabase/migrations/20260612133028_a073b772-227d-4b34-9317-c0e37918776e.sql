-- TODO: remover estas policies após migrar manualmente os arquivos legados
-- para o formato {tenant_id}/categoria/arquivo.ext.
-- Elas dão SELECT (somente leitura) a arquivos cujo PRIMEIRO segmento NÃO é um UUID
-- (presumivelmente legados, salvos antes do isolamento por tenant).
-- Risco aceito: usuários autenticados conseguem ler arquivos legados de outras lojas
-- até a limpeza manual. Novos uploads já seguem o padrão tenant-prefixado.

CREATE POLICY "tecido-variantes legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tecido-variantes'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

CREATE POLICY "aviamentos legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'aviamentos'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

CREATE POLICY "artigos legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'artigos'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

CREATE POLICY "modelos legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'modelos'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

CREATE POLICY "oc-tecido legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'oc-tecido'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

CREATE POLICY "oc-aviamento legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'oc-aviamento'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

CREATE POLICY "comprovantes legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'comprovantes'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');

CREATE POLICY "lancamentos legacy read TODO" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lancamentos'
         AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');