CREATE POLICY "auth read oc-aviamento" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'oc-aviamento');
CREATE POLICY "auth insert oc-aviamento" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'oc-aviamento');
CREATE POLICY "auth update oc-aviamento" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'oc-aviamento');
CREATE POLICY "auth delete oc-aviamento" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'oc-aviamento');