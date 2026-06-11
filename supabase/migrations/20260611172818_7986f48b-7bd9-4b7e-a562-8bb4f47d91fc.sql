CREATE POLICY "auth read oc-tecido" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'oc-tecido');
CREATE POLICY "auth insert oc-tecido" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'oc-tecido');
CREATE POLICY "auth update oc-tecido" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'oc-tecido');
CREATE POLICY "auth delete oc-tecido" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'oc-tecido');