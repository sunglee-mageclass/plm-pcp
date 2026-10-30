-- Volta de supabase/migrations/20261103195000_urg_r9_permissao_secao.sql (urg R9d) = NO-OP DOCUMENTADO (neutro).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 4 / R9d).
-- As linhas 'criacao_planejamento:peca_teste' de user_permissions/papel_permissoes FICAM: com o site voltado ninguem le a chave
-- (o portao do servidor esta no salvar_peca_teste da 193000, que o 193000_down neutraliza). Apagar permissao concedida NAO e volta
-- neutra (o admin pode ter ajustado depois). Se o dono quiser apagar, e passo MANUAL do roteiro (horario qualquer, so linhas):
--   DELETE FROM public.user_permissions WHERE pagina = 'criacao_planejamento:peca_teste';
--   DELETE FROM public.papel_permissoes WHERE pagina = 'criacao_planejamento:peca_teste';
-- Sem _down_drop (nao ha objeto novo). Idempotente; nenhuma trava.
-- Ordem LIFO: 196000_down -> ESTE -> 194000_down -> 193000_down -> 192000_down.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;

DO $volta$
BEGIN
  RAISE NOTICE 'urg_r9d_down: no-op (as linhas da secao criacao_planejamento:peca_teste ficam; ver o cabecalho)';
END
$volta$;

COMMIT;
