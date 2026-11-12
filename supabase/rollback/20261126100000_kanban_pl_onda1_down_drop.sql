-- Volta DESTRUTIVA do Kanban PL - Onda 1 (OPCIONAL, DEPOIS do _down, HORARIO CALMO).
-- Dropa os objetos NOVOS dos blocos A/B/D. Como sao objetos novos sem dado de producao ainda, o DROP e seguro.
-- ATENCAO (travas ate o COMMIT):
--   - ALTER TABLE ... DROP COLUMN em public.modelos (status_etapa_pl): AccessExclusive em modelos.
--   - ALTER TABLE ... DROP COLUMN em public.tenant_config (4 colunas): AccessExclusive em tenant_config
--     (toda checagem de RLS/tenant_module_enabled le esta tabela -> fila no app inteiro) + prende auth/storage via supautils.
--   - DROP TABLE modelo_etapa_pl_historico.
-- Rodar o _down (neutraliza salvar_config_loja) ANTES: a funcao neutra ja nao referencia as 4 colunas.
-- Aplicar FORA de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. Idempotente (IF EXISTS).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DROP FUNCTION IF EXISTS public._kanban_pl_seed_etapas(uuid);

ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS etapas_pl_kanban;
ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS etapas_pl_requisitos;
ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS etapas_pl_automatico;
ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS etapas_pl_aba_peca_teste_status;

DROP TABLE IF EXISTS public.modelo_etapa_pl_historico;
ALTER TABLE public.modelos DROP COLUMN IF EXISTS status_etapa_pl;

NOTIFY pgrst, 'reload schema';
COMMIT;
