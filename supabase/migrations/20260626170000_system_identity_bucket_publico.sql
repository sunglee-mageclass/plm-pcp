-- O branding do sistema (logo/favicon) é PÚBLICO (aparece no login deslogado e em
-- todo o app). Usar URL ASSINADA (createSignedUrl, TTL 1h) causava o bug "a logo não
-- fica salva ao deslogar/logar": a URL expira / depende de RLS / nem sempre recarrega.
-- Tornar o bucket público => URL estável (getPublicUrl), sem expirar e sem round-trip
-- de assinatura (mais rápido). Escrita continua restrita a super_admin (policies de
-- INSERT/UPDATE/DELETE mantidas).
UPDATE storage.buckets SET public = true WHERE id = 'system-identity';
