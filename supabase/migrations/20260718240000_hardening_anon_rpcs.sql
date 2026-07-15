-- Hardening de RPC (audit de saúde jul/2026) — invariante #9.
-- Quatro funções SECURITY DEFINER estavam executáveis por ANON (has_function_privilege
-- ('anon',…)=true): o default ACL do Postgres concede EXECUTE a PUBLIC, e anon herda de PUBLIC.
-- Todas checam `get_user_tenant_id() IS NULL`, MAS essa função devolve um SENTINELA (não NULL)
-- p/ sessão sem tenant, então o null-check NÃO barra anon — ele só é barrado por efeito
-- colateral (o mesmo padrão frágil já corrigido no _criar_rolo_core). Duas delas ESCREVEM:
--   • otb_salvar_colecao      → anon poderia gravar coleção/subcoleções no tenant-sentinela
--   • set_empresa_categorias  → anon poderia criar/alterar empresa no tenant-sentinela
-- Duas leem (avaliar_condicoes_kanban, servico_aprovacao_por_modelo).
-- Fix canônico: revogar dos TRÊS e reconceder só a authenticated (o app usa authenticated;
-- nenhum caminho legítimo é afetado). Confirme com has_function_privilege (teste de integração).
--
-- NÃO tocado de propósito (verificado — não são brechas):
--   • reset_loja/excluir_loja: anon já bloqueado + guarda is_super_admin() interna (RAISE).
--   • destinos_saida/etiquetas: escrita é cadastro normal (não admin-only); RLS por tenant é o
--     nível certo — exigir admin quebraria usuário de cadastro não-admin.
--   • custo_unitario_modelos: anon já bloqueado; gate por página é decisão de design (deferido).
--   • salvar_os/baixar_os/desmarcar_os: anon já bloqueado + tenant derivado da sessão; gate de
--     módulo é defense-in-depth (deferido — evita reescrever 3 corpos grandes).

REVOKE EXECUTE ON FUNCTION public.otb_salvar_colecao(jsonb)               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.otb_salvar_colecao(jsonb)               TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_empresa_categorias(jsonb, uuid[])   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.set_empresa_categorias(jsonb, uuid[])   TO authenticated;

REVOKE EXECUTE ON FUNCTION public.servico_aprovacao_por_modelo(uuid[])    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.servico_aprovacao_por_modelo(uuid[])    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.avaliar_condicoes_kanban(uuid[])        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.avaliar_condicoes_kanban(uuid[])        TO authenticated;

select pg_notify('pgrst','reload schema');
