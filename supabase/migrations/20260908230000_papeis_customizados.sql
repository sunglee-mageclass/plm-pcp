-- #4d — Papéis/roles CUSTOMIZADOS (presets de permissão reutilizáveis, POR LOJA).
-- Decisões do dono (brainstorm set/2026):
--   • Vínculo + override: usuário aponta pro papel (users.papel_id); user_permissions vira a
--     camada de EXCEÇÃO. Permissão efetiva por página = exceção do usuário SENÃO papel SENÃO negado.
--   • Papéis POR LOJA (papeis.tenant_id); tenant_admin cria os da própria loja, super_admin na ativa.
--   • Resolver AO VIVO (sem materializar): helper _perm_efetiva faz o COALESCE; user_can_view/edit e
--     o front (via RPC minhas_permissoes_efetivas) consomem a lista JÁ resolvida — gate NÃO muda.
--
-- Não destrutiva; idempotente (IF NOT EXISTS). As 3 funções alteradas
-- (user_can_view/user_can_edit/set_user_permissions) são diff-validadas fora deste arquivo.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Tabelas novas (tenant-scoped, RLS + trigger set_tenant_id como as demais)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.papeis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  nome       text NOT NULL,
  descricao  text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Nome único por loja (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS papeis_tenant_nome_uniq
  ON public.papeis (tenant_id, lower(nome));

CREATE TABLE IF NOT EXISTS public.papel_permissoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  papel_id    uuid NOT NULL REFERENCES public.papeis(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id),
  pagina      varchar(255) NOT NULL,
  pode_ver    boolean NOT NULL DEFAULT false,
  pode_editar boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (papel_id, pagina)
);
CREATE INDEX IF NOT EXISTS papel_permissoes_papel_idx ON public.papel_permissoes (papel_id);

-- Vínculo usuário → papel. ON DELETE SET NULL: papel apagado NÃO quebra login (usuário fica só
-- com as próprias exceções, o que a guarda do excluir_papel já impede na prática).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS papel_id uuid REFERENCES public.papeis(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_papel_id_idx ON public.users (papel_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RLS — espelha user_permissions: self-read + tenant_admin(própria loja) + super_admin
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.papeis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.papel_permissoes ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário da loja pode LER os papéis da própria loja (o dropdown de papel e o
-- herdado-vs-exceção precisam disso; escrita segue restrita a admin).
DROP POLICY IF EXISTS papeis_read ON public.papeis;
CREATE POLICY papeis_read ON public.papeis FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS papeis_admin_tenant ON public.papeis;
CREATE POLICY papeis_admin_tenant ON public.papeis FOR ALL
  USING (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id())
  WITH CHECK (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS papeis_admin_super ON public.papeis;
CREATE POLICY papeis_admin_super ON public.papeis FOR ALL
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS papel_perms_read ON public.papel_permissoes;
CREATE POLICY papel_perms_read ON public.papel_permissoes FOR SELECT
  USING (tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
DROP POLICY IF EXISTS papel_perms_admin_tenant ON public.papel_permissoes;
CREATE POLICY papel_perms_admin_tenant ON public.papel_permissoes FOR ALL
  USING (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id())
  WITH CHECK (public.is_tenant_admin() AND tenant_id = public.get_user_tenant_id());
DROP POLICY IF EXISTS papel_perms_admin_super ON public.papel_permissoes;
CREATE POLICY papel_perms_admin_super ON public.papel_permissoes FOR ALL
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- tenant_id automático nas duas tabelas.
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.papeis;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.papeis
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();
DROP TRIGGER IF EXISTS set_tenant_id_trg ON public.papel_permissoes;
CREATE TRIGGER set_tenant_id_trg BEFORE INSERT ON public.papel_permissoes
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Helper de resolução AO VIVO (override do usuário SENÃO papel). SECURITY DEFINER,
--    EXECUTE revogado dos TRÊS (invariante #9): recebe user_id por parâmetro, é interno.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._perm_efetiva(_user_id uuid)
 RETURNS TABLE(pagina text, pode_ver boolean, pode_editar boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Exceção do usuário (user_permissions) vence; onde não há exceção, herda do papel
  -- (papel_permissoes do users.papel_id). FULL JOIN cobre página presente só num lado.
  WITH u AS (
    SELECT pagina, pode_ver, pode_editar
    FROM public.user_permissions WHERE user_id = _user_id
  ),
  p AS (
    SELECT pp.pagina, pp.pode_ver, pp.pode_editar
    FROM public.papel_permissoes pp
    JOIN public.users usr ON usr.papel_id = pp.papel_id
    WHERE usr.id = _user_id
  )
  SELECT
    COALESCE(u.pagina, p.pagina) AS pagina,
    COALESCE(u.pode_ver, p.pode_ver, false) AS pode_ver,
    COALESCE(u.pode_editar, p.pode_editar, false) AS pode_editar
  FROM u FULL JOIN p ON u.pagina = p.pagina
  WHERE COALESCE(u.pode_ver, p.pode_ver, false)
     OR COALESCE(u.pode_editar, p.pode_editar, false);
$function$;
REVOKE EXECUTE ON FUNCTION public._perm_efetiva(uuid) FROM public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) user_can_view / user_can_edit — passam a resolver via _perm_efetiva.
--    Bypass de admin INTACTO (reproduzido byte-a-byte); só troca o EXISTS(user_permissions).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.user_can_view(_pagina text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tenant_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public._perm_efetiva(auth.uid()) e
      WHERE e.pagina = _pagina AND e.pode_ver = true
    );
$function$;

CREATE OR REPLACE FUNCTION public.user_can_edit(_pagina text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.is_super_admin()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'tenant_admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public._perm_efetiva(auth.uid()) e
      WHERE e.pagina = _pagina AND e.pode_editar = true
    );
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RPC lida pelo front (useAuth): permissões efetivas DO PRÓPRIO usuário (sem IDOR).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.minhas_permissoes_efetivas()
 RETURNS TABLE(pagina text, pode_ver boolean, pode_editar boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pagina, pode_ver, pode_editar FROM public._perm_efetiva(auth.uid());
$function$;
REVOKE EXECUTE ON FUNCTION public.minhas_permissoes_efetivas() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.minhas_permissoes_efetivas() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) Gestão de papéis (authz própria: super_admin escolhe loja; tenant_admin só a própria).
-- ─────────────────────────────────────────────────────────────────────────────
-- Resolve a loja-alvo autorizada (mesma régua do set_user_permissions).
CREATE OR REPLACE FUNCTION public._papel_tenant_autorizado(_tenant_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF public.is_super_admin() THEN
    v_tenant := _tenant_id;
  ELSIF public.is_tenant_admin() THEN
    v_tenant := public.get_user_tenant_id();
  ELSE
    RAISE EXCEPTION 'Sem permissão para gerenciar papéis';
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Loja não informada'; END IF;
  RETURN v_tenant;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._papel_tenant_autorizado(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_papel(_id uuid, _tenant_id uuid, _nome text, _descricao text, _perms jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_id uuid; v_nome text;
BEGIN
  v_tenant := public._papel_tenant_autorizado(_tenant_id);
  v_nome := nullif(btrim(_nome), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do papel.' USING ERRCODE = 'P0001'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.papeis (tenant_id, nome, descricao)
    VALUES (v_tenant, v_nome, nullif(btrim(_descricao), ''))
    RETURNING id INTO v_id;
  ELSE
    -- Alvo tem que ser da loja resolvida (impede editar papel de outra loja).
    IF NOT EXISTS (SELECT 1 FROM public.papeis WHERE id = _id AND tenant_id = v_tenant) THEN
      RAISE EXCEPTION 'Papel não encontrado nesta loja';
    END IF;
    UPDATE public.papeis
       SET nome = v_nome, descricao = nullif(btrim(_descricao), '')
     WHERE id = _id AND tenant_id = v_tenant;
    v_id := _id;
  END IF;

  -- Substitui as permissões do papel atomicamente (delete + insert), como set_user_permissions.
  DELETE FROM public.papel_permissoes WHERE papel_id = v_id;
  INSERT INTO public.papel_permissoes (papel_id, tenant_id, pagina, pode_ver, pode_editar)
  SELECT v_id, v_tenant, p->>'pagina',
         COALESCE((p->>'pode_ver')::boolean, false),
         COALESCE((p->>'pode_editar')::boolean, false)
  FROM jsonb_array_elements(COALESCE(_perms, '[]'::jsonb)) p
  WHERE NULLIF(p->>'pagina','') IS NOT NULL
    AND (COALESCE((p->>'pode_ver')::boolean, false) OR COALESCE((p->>'pode_editar')::boolean, false));

  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Já existe um papel com este nome nesta loja.' USING ERRCODE = 'P0001';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.salvar_papel(uuid, uuid, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.salvar_papel(uuid, uuid, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.excluir_papel(_id uuid, _tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_usos int;
BEGIN
  v_tenant := public._papel_tenant_autorizado(_tenant_id);
  IF NOT EXISTS (SELECT 1 FROM public.papeis WHERE id = _id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Papel não encontrado nesta loja';
  END IF;
  -- Guarda: não exclui papel EM USO (sem CASCADE silencioso p/ users.papel_id).
  SELECT count(*) INTO v_usos FROM public.users WHERE papel_id = _id;
  IF v_usos > 0 THEN
    RAISE EXCEPTION '% usuário(s) usam este papel — troque o papel deles antes de excluir.', v_usos
      USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.papeis WHERE id = _id AND tenant_id = v_tenant; -- papel_permissoes cascateia
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.excluir_papel(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.excluir_papel(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.definir_papel_usuario(_user_id uuid, _papel_id uuid, _tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  v_tenant := public._papel_tenant_autorizado(_tenant_id);
  -- Alvo é da loja resolvida.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = _user_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Usuário não pertence à loja';
  END IF;
  -- Papel (quando informado) é da MESMA loja.
  IF _papel_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.papeis WHERE id = _papel_id AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'Papel não pertence à loja';
  END IF;
  UPDATE public.users SET papel_id = _papel_id WHERE id = _user_id AND tenant_id = v_tenant;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.definir_papel_usuario(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.definir_papel_usuario(uuid, uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) set_user_permissions — passa a gravar SÓ o DELTA vs o papel do usuário.
--    O cliente manda o estado marcado inteiro; o servidor compara com o papel e insere só as
--    linhas que DIVERGEM (exceções). Sem papel → grava tudo, como antes (retrocompatível).
--    Comparação no servidor (não confia no cliente). Diff-validar vs ANTES.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_user_permissions(_user_id uuid, _tenant_id uuid, _perms jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_papel uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

  -- Authz: super_admin escolhe a loja (_tenant_id); tenant_admin só a própria.
  IF public.is_super_admin() THEN
    v_tenant := _tenant_id;
  ELSIF public.is_tenant_admin() THEN
    v_tenant := public.get_user_tenant_id();
  ELSE
    RAISE EXCEPTION 'Sem permissão para gerenciar permissões';
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Loja não informada'; END IF;

  -- Alvo tem que ser da loja resolvida.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = _user_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Usuário não pertence à loja';
  END IF;

  SELECT papel_id INTO v_papel FROM public.users WHERE id = _user_id;

  -- Substitui atomicamente as exceções do usuário. DELETE e INSERT são statements SEPARADOS
  -- (mesma txn) — NÃO um CTE `WITH _del AS (DELETE…) INSERT…`: nesse formato o snapshot do
  -- comando não garante que o DELETE seja visível ao INSERT, colidindo com o índice único
  -- (user_id,pagina) quando a linha já existia. (Bug pego no teste txn; o set original também
  -- usava 2 statements.)
  DELETE FROM public.user_permissions WHERE user_id = _user_id;

  INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
  WITH incoming AS (
    SELECT p->>'pagina' AS pagina,
           COALESCE((p->>'pode_ver')::boolean, false) AS pode_ver,
           COALESCE((p->>'pode_editar')::boolean, false) AS pode_editar
    FROM jsonb_array_elements(COALESCE(_perms, '[]'::jsonb)) p
    WHERE NULLIF(p->>'pagina','') IS NOT NULL
      AND (COALESCE((p->>'pode_ver')::boolean, false) OR COALESCE((p->>'pode_editar')::boolean, false))
  ),
  -- Papel do usuário (base). Se não há papel, vazio → todo o incoming vira exceção (= comport. antigo).
  base AS (
    SELECT pp.pagina, pp.pode_ver, pp.pode_editar
    FROM public.papel_permissoes pp
    WHERE v_papel IS NOT NULL AND pp.papel_id = v_papel
  ),
  -- União das páginas tocadas nos dois lados. Uma página que o papel concede mas o cliente
  -- NÃO marcou precisa virar exceção NEGATIVA (linha com ver=false/editar=false) — senão o
  -- COALESCE de _perm_efetiva herdaria o papel de volta. Guardamos essas como linha explícita.
  keys AS (
    SELECT pagina FROM incoming UNION SELECT pagina FROM base
  ),
  resolved AS (
    SELECT k.pagina,
           COALESCE(i.pode_ver, false)    AS pode_ver,
           COALESCE(i.pode_editar, false) AS pode_editar,
           COALESCE(b.pode_ver, false)    AS base_ver,
           COALESCE(b.pode_editar, false) AS base_editar
    FROM keys k
    LEFT JOIN incoming i ON i.pagina = k.pagina
    LEFT JOIN base b     ON b.pagina = k.pagina
  ),
  -- Exceção = onde o desejado DIVERGE do papel. (Sem papel, base_* é false → tudo que é
  -- verdadeiro no cliente diverge, reproduzindo o insert-tudo antigo.)
  delta AS (
    SELECT pagina, pode_ver, pode_editar
    FROM resolved
    WHERE pode_ver IS DISTINCT FROM base_ver OR pode_editar IS DISTINCT FROM base_editar
  )
  SELECT _user_id, v_tenant, pagina, pode_ver, pode_editar FROM delta;
END;
$function$;
-- ACL do set_user_permissions permanece como estava (authenticated executa; a authz é interna).

COMMIT;

select pg_notify('pgrst','reload schema');
