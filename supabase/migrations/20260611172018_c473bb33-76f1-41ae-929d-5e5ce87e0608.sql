CREATE POLICY "Authenticated read aviamentos" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'aviamentos');
CREATE POLICY "Authenticated upload aviamentos" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'aviamentos');
CREATE POLICY "Authenticated update aviamentos" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'aviamentos');
CREATE POLICY "Authenticated delete aviamentos" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'aviamentos');