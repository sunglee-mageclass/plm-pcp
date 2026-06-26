-- A logo da LOJA (bucket tenant-logos, tenants.logo_url) aparece no cabeçalho dos
-- relatórios imprimíveis e na UI. Usar URL ASSINADA (createSignedUrl, TTL 1h) causa o
-- mesmo bug latente já visto no system-identity: "a logo não fica salva" (a URL expira /
-- depende de RLS / nem sempre recarrega). Tornar o bucket público => URL estável
-- (getPublicUrl), sem expirar e sem round-trip de assinatura (mais rápido). Escrita
-- continua restrita (policies de INSERT/UPDATE/DELETE por super_admin + path por tenant
-- mantidas).
UPDATE storage.buckets SET public = true WHERE id = 'tenant-logos';
