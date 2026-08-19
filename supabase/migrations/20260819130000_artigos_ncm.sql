-- Tecidos (artigos) ganham NCM (código fiscal digitável), espelhando o NCM do aviamento
-- (migration 20260718170000_aviamento_ncm_cores.sql). Aditiva: coluna nullable, nada a
-- migrar nas linhas existentes.
--
-- ACL: `artigos` usa GRANTs em nível de TABELA (RLS tenant-scoped) — não há nenhum GRANT/
-- REVOKE por-coluna no schema, então a coluna nova é automaticamente coberta pelos
-- privilégios existentes de SELECT/INSERT/UPDATE do `authenticated`. Nada a conceder.
BEGIN;

ALTER TABLE public.artigos
  ADD COLUMN IF NOT EXISTS ncm text;

COMMIT;
