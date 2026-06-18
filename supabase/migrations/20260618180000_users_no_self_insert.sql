-- Segurança: impede escalonamento entre lojas.
-- A policy "Insert self user" deixava um cadastro novo INSERIR a própria linha em
-- public.users escolhendo tenant_id/role (o trigger prevent_users_self_role_change
-- é BEFORE UPDATE, não cobre INSERT). Removida: usuários só entram numa loja por
-- super_admin/admin (server-side, via supabaseAdmin). O signup só cria
-- profiles + user_roles('user'); o admin é quem atribui loja/role.
DROP POLICY IF EXISTS "Insert self user" ON public.users;
