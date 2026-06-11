CREATE POLICY "Authenticated can view tecido-variantes"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'tecido-variantes');

CREATE POLICY "Authenticated can upload tecido-variantes"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'tecido-variantes');

CREATE POLICY "Authenticated can update tecido-variantes"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'tecido-variantes');

CREATE POLICY "Authenticated can delete tecido-variantes"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'tecido-variantes');