
CREATE TABLE public.system_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  singleton BOOLEAN NOT NULL DEFAULT TRUE UNIQUE,
  nome_sistema TEXT NOT NULL DEFAULT 'PLM+PCP',
  subtitulo TEXT NOT NULL DEFAULT 'Moda & Confecção',
  logo_url TEXT,
  favicon_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_settings_singleton_chk CHECK (singleton = TRUE)
);

GRANT SELECT ON public.system_settings TO authenticated;
GRANT UPDATE, INSERT ON public.system_settings TO authenticated;
GRANT ALL ON public.system_settings TO service_role;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados podem ler identidade"
  ON public.system_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Super admin pode inserir identidade"
  ON public.system_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "Super admin pode atualizar identidade"
  ON public.system_settings FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE TRIGGER update_system_settings_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.system_settings (singleton) VALUES (TRUE);

-- Storage policies para bucket system-identity
CREATE POLICY "Identidade: leitura autenticada"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'system-identity');

CREATE POLICY "Identidade: upload super admin"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'system-identity' AND public.is_super_admin());

CREATE POLICY "Identidade: update super admin"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'system-identity' AND public.is_super_admin());

CREATE POLICY "Identidade: delete super admin"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'system-identity' AND public.is_super_admin());
