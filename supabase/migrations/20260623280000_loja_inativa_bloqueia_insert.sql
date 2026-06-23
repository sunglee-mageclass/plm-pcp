-- Loja inativa conseguia INSERT (criava linhas-órfãs com tenant_id = sentinela nil):
-- a suspensão (loja inativa) só barrava UPDATE/DELETE de linhas existentes via RLS.
-- get_user_tenant_id() devolve o sentinela '0000...' p/ usuário de loja inativa (ou
-- sem tenant); o trigger set_tenant_id preenchia NEW.tenant_id com ele e a policy
-- tenant_insert (= get_user_tenant_id() OR IS NULL) passava.
--
-- Fix central: guard no trigger set_tenant_id (compartilhado por 43 tabelas, só no
-- INSERT) — bloqueia quando o tenant resolvido é o sentinela e o usuário não é
-- super_admin. As 2 tabelas-link sem o trigger (artigo_categorias_tecido,
-- terceirizado_categorias) ganham o guard meu_tenant_ativo() na própria policy.

CREATE OR REPLACE FUNCTION public.set_tenant_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := public.get_user_tenant_id();
  END IF;
  -- Loja inativa / usuário sem tenant resolve p/ o sentinela nil. Sem este guard, o
  -- INSERT gravava linha-órfã (a suspensão só barrava UPDATE/DELETE). super_admin isento.
  IF NEW.tenant_id = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- Tabelas-link sem o trigger set_tenant_id: guard na policy de INSERT.
DROP POLICY IF EXISTS "tenant insert" ON public.artigo_categorias_tecido;
CREATE POLICY "tenant insert" ON public.artigo_categorias_tecido
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = get_user_tenant_id()) OR (tenant_id IS NULL)) AND public.meu_tenant_ativo());

DROP POLICY IF EXISTS "tenant insert" ON public.terceirizado_categorias;
CREATE POLICY "tenant insert" ON public.terceirizado_categorias
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((tenant_id = get_user_tenant_id()) OR (tenant_id IS NULL)) AND public.meu_tenant_ativo());
