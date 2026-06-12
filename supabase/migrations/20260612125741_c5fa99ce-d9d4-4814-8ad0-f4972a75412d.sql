
-- Drop old, non-isolated bucket policies
DROP POLICY IF EXISTS "Authenticated can delete tecido-variantes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update tecido-variantes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload tecido-variantes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can view tecido-variantes" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete aviamentos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read aviamentos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update aviamentos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload aviamentos" ON storage.objects;
DROP POLICY IF EXISTS "artigos bucket delete" ON storage.objects;
DROP POLICY IF EXISTS "artigos bucket insert" ON storage.objects;
DROP POLICY IF EXISTS "artigos bucket select" ON storage.objects;
DROP POLICY IF EXISTS "artigos bucket update" ON storage.objects;
DROP POLICY IF EXISTS "auth delete modelos" ON storage.objects;
DROP POLICY IF EXISTS "auth delete oc-aviamento" ON storage.objects;
DROP POLICY IF EXISTS "auth delete oc-tecido" ON storage.objects;
DROP POLICY IF EXISTS "auth insert modelos" ON storage.objects;
DROP POLICY IF EXISTS "auth insert oc-aviamento" ON storage.objects;
DROP POLICY IF EXISTS "auth insert oc-tecido" ON storage.objects;
DROP POLICY IF EXISTS "auth read modelos" ON storage.objects;
DROP POLICY IF EXISTS "auth read oc-aviamento" ON storage.objects;
DROP POLICY IF EXISTS "auth read oc-tecido" ON storage.objects;
DROP POLICY IF EXISTS "auth update modelos" ON storage.objects;
DROP POLICY IF EXISTS "auth update oc-aviamento" ON storage.objects;
DROP POLICY IF EXISTS "auth update oc-tecido" ON storage.objects;
DROP POLICY IF EXISTS "comprovantes_delete" ON storage.objects;
DROP POLICY IF EXISTS "comprovantes_insert" ON storage.objects;
DROP POLICY IF EXISTS "comprovantes_select" ON storage.objects;
DROP POLICY IF EXISTS "comprovantes_update" ON storage.objects;
DROP POLICY IF EXISTS "lancamentos_authenticated_all" ON storage.objects;

-- Helper macro: tenant-scoped policies for each bucket (first folder = tenant_id)
-- tecido-variantes
CREATE POLICY "tecido-variantes tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'tecido-variantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "tecido-variantes tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tecido-variantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "tecido-variantes tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'tecido-variantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'tecido-variantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "tecido-variantes tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'tecido-variantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- aviamentos
CREATE POLICY "aviamentos tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'aviamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "aviamentos tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'aviamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "aviamentos tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'aviamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'aviamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "aviamentos tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'aviamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- artigos
CREATE POLICY "artigos tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'artigos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "artigos tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'artigos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "artigos tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'artigos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'artigos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "artigos tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'artigos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- modelos
CREATE POLICY "modelos tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'modelos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "modelos tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'modelos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "modelos tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'modelos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'modelos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "modelos tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'modelos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- oc-tecido
CREATE POLICY "oc-tecido tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'oc-tecido' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "oc-tecido tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'oc-tecido' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "oc-tecido tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'oc-tecido' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'oc-tecido' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "oc-tecido tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'oc-tecido' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- oc-aviamento
CREATE POLICY "oc-aviamento tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'oc-aviamento' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "oc-aviamento tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'oc-aviamento' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "oc-aviamento tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'oc-aviamento' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'oc-aviamento' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "oc-aviamento tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'oc-aviamento' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- comprovantes
CREATE POLICY "comprovantes tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "comprovantes tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "comprovantes tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "comprovantes tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'comprovantes' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);

-- lancamentos
CREATE POLICY "lancamentos tenant select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'lancamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "lancamentos tenant insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'lancamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "lancamentos tenant update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'lancamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text)
  WITH CHECK (bucket_id = 'lancamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
CREATE POLICY "lancamentos tenant delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'lancamentos' AND (storage.foldername(name))[1] = get_user_tenant_id()::text);
