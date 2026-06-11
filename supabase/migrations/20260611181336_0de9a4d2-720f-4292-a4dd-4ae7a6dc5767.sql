CREATE POLICY "lancamentos_authenticated_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'lancamentos')
  WITH CHECK (bucket_id = 'lancamentos');