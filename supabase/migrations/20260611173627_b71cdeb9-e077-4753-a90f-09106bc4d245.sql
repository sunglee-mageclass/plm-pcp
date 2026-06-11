CREATE POLICY "auth read modelos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'modelos');
CREATE POLICY "auth insert modelos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'modelos');
CREATE POLICY "auth update modelos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'modelos');
CREATE POLICY "auth delete modelos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'modelos');