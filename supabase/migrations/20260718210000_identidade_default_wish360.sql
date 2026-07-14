-- Alinha o DEFAULT do nome do sistema ao branding vivo (era 'PLM+PCP', nome antigo).
-- Só afeta INSERT sem valor (a linha singleton já existe = 'WISH360'); não muda dado.
BEGIN;
ALTER TABLE public.system_settings ALTER COLUMN nome_sistema SET DEFAULT 'WISH360';
COMMIT;
