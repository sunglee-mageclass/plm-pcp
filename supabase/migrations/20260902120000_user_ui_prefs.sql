-- Preferências de UI POR USUÁRIO, persistidas no BANCO (seguem o login em qualquer
-- dispositivo — antes eram só localStorage por-navegador). Tabela genérica: `scope`
-- separa 'filtro' de 'agrupar' (e futuras prefs de UI). `value` guarda um array de
-- strings (mesmo shape do filtro; para agrupamento = dimensões ativas).
--
-- RLS: cada usuário só vê/edita as PRÓPRIAS linhas (user_id = auth.uid()), dentro do
-- seu tenant. Mais restrito que o padrão só-tenant do projeto — preferência é privada
-- do usuário, não compartilhada na loja. tenant_id é derivado no servidor pelo trigger
-- set_tenant_id() (o front nunca envia). users.id == auth.uid() neste projeto
-- (get_user_tenant_id() usa `WHERE u.id = auth.uid()`), então a FK e a RLS casam.
--
-- Não-destrutiva (só CREATE) + idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS).

CREATE TABLE IF NOT EXISTS public.user_ui_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,           -- 'filtro' | 'agrupar' (extensível)
  pref_key TEXT NOT NULL,        -- "{screen}:{key}" (ex.: "cadastro-tecidos:categoria")
  value JSONB NOT NULL,          -- string[] (seleção do filtro; dimensões ativas do agrupar)
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, scope, pref_key)
);
CREATE INDEX IF NOT EXISTS idx_user_ui_prefs_user ON public.user_ui_prefs(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_prefs TO authenticated;
GRANT ALL ON public.user_ui_prefs TO service_role;
ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;

-- Só as próprias linhas (user_id = auth.uid()) e dentro do tenant ativo.
DROP POLICY IF EXISTS "own_select" ON public.user_ui_prefs;
CREATE POLICY "own_select" ON public.user_ui_prefs FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS "own_insert" ON public.user_ui_prefs;
CREATE POLICY "own_insert" ON public.user_ui_prefs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (tenant_id = public.get_user_tenant_id() OR tenant_id IS NULL));
DROP POLICY IF EXISTS "own_update" ON public.user_ui_prefs;
CREATE POLICY "own_update" ON public.user_ui_prefs FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own_delete" ON public.user_ui_prefs;
CREATE POLICY "own_delete" ON public.user_ui_prefs FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- tenant_id derivado no servidor (padrão do projeto); RAISE se loja inativa (super isento).
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.user_ui_prefs;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.user_ui_prefs
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

NOTIFY pgrst, 'reload schema';
