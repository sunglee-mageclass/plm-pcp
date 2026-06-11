CREATE POLICY "comprovantes_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'comprovantes');
CREATE POLICY "comprovantes_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'comprovantes');
CREATE POLICY "comprovantes_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'comprovantes');
CREATE POLICY "comprovantes_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'comprovantes');