UPDATE public.system_settings
SET logo_url = 'logo-sistrama-1749744000.png',
    favicon_url = 'favicon-sistrama-1749744000.png',
    updated_at = now()
WHERE singleton = true;

INSERT INTO public.system_settings (singleton, nome_sistema, subtitulo, logo_url, favicon_url)
SELECT true, 'sisTrama', 'Moda & Confecção', 'logo-sistrama-1749744000.png', 'favicon-sistrama-1749744000.png'
WHERE NOT EXISTS (SELECT 1 FROM public.system_settings WHERE singleton = true);