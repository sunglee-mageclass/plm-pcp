-- A identidade do sistema (nome/subtítulo/logo/favicon) é o branding PÚBLICO mostrado
-- na home e no login deslogados. Antes só `authenticated` lia `system_settings` e o
-- bucket `system-identity`, então a home (role anon) caía nas iniciais "SI" em vez da
-- logo. Libera leitura para `anon` (continua só super_admin podendo escrever).

GRANT SELECT ON public.system_settings TO anon;

DROP POLICY IF EXISTS "Anon pode ler identidade" ON public.system_settings;
CREATE POLICY "Anon pode ler identidade"
  ON public.system_settings FOR SELECT TO anon USING (true);

-- Storage: leitura anon dos objetos do bucket de identidade (logo/favicon) — necessária
-- para o createSignedUrl funcionar deslogado.
DROP POLICY IF EXISTS "Identidade: leitura anon" ON storage.objects;
CREATE POLICY "Identidade: leitura anon"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'system-identity');
