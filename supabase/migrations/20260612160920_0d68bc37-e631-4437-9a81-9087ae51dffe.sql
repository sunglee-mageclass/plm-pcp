DROP POLICY IF EXISTS "artigos legacy read TODO" ON storage.objects;
DROP POLICY IF EXISTS "aviamentos legacy read TODO" ON storage.objects;
DROP POLICY IF EXISTS "comprovantes legacy read TODO" ON storage.objects;
DROP POLICY IF EXISTS "lancamentos legacy read TODO" ON storage.objects;
DROP POLICY IF EXISTS "modelos legacy read TODO" ON storage.objects;
DROP POLICY IF EXISTS "oc-aviamento legacy read TODO" ON storage.objects;
DROP POLICY IF EXISTS "oc-tecido legacy read TODO" ON storage.objects;
DROP POLICY IF EXISTS "tecido-variantes legacy read TODO" ON storage.objects;

CREATE POLICY "artigos legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='artigos' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());
CREATE POLICY "aviamentos legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='aviamentos' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());
CREATE POLICY "comprovantes legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='comprovantes' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());
CREATE POLICY "lancamentos legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='lancamentos' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());
CREATE POLICY "modelos legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='modelos' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());
CREATE POLICY "oc-aviamento legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='oc-aviamento' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());
CREATE POLICY "oc-tecido legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='oc-tecido' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());
CREATE POLICY "tecido-variantes legacy read super_admin" ON storage.objects FOR SELECT TO authenticated USING (bucket_id='tecido-variantes' AND (storage.foldername(name))[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND is_super_admin());