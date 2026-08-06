-- Direcionamento multi-lojas — fast-follow de hardening (review final, aprovado pelo dono).
-- 2 achados:
--
-- 1) Escrita nas LINHAS de direcionamento virou RPC-only. `direcionamento_lojas` (modelo
--    novo, multi-lojas) e `direcionamento` (legado, INERTE — só rebaixe/limpezas tocam)
--    tinham INSERT/UPDATE/DELETE liberados pro PostgREST (ALTER DEFAULT PRIVILEGES concede
--    ALL a `authenticated`/`anon` em toda tabela nova). Nenhum código cliente escreve
--    direto nessas 2 tabelas hoje (grep confirmado — a tela de Direcionamento só faz SELECT
--    em `direcionamento_lojas`; todo save/confirma passa por `salvar_direcionamento`/
--    `confirmar_direcionamento`, RPCs SECURITY DEFINER que validam grade/CQ/loja no
--    servidor). Fechar a escrita direta remove um caminho que bypassa essas validações. NÃO
--    mexe em `lojas_direcionamento` (o CADASTRO de lojas) — a página escreve nela direto e a
--    RLS já exige tenant_admin/super_admin (migração 20260805120000).
--
-- 2) REVOKE de verdade nos 4 `excluir_*` sensíveis. O REVOKE anterior (nas migrações de
--    origem de cada um) só tirava `anon` — inócuo, porque o Postgres concede EXECUTE a
--    PUBLIC por padrão em toda função nova, e `anon`/`authenticated` HERDAM de PUBLIC
--    (mesma classe do invariante #9 do CLAUDE.md, aplicada agora às funções DEFINER de
--    exclusão). Revoga PUBLIC nos 4; `authenticated` continua podendo (são wrappers que já
--    fazem a guarda certa por dentro — `excluir_loja_direcionamento` exige tenant_admin/
--    super_admin no corpo; os outros 3 contam uso e RAISE).
BEGIN;

REVOKE INSERT, UPDATE, DELETE ON public.direcionamento_lojas FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.direcionamento       FROM authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.excluir_loja_direcionamento(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.excluir_tecido(uuid)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.excluir_variante_tecido(uuid)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.excluir_rolo(uuid)                FROM PUBLIC, anon;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
