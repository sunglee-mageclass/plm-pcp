-- Forçar logout: revoga as sessões de um usuário (auth.sessions + refresh_tokens),
-- derrubando-o no próximo refresh do token / reload (o JWT em si dura ~1h). É RECUPERÁVEL:
-- o usuário pode logar de novo (diferente de inativar/excluir).
-- Autorização: super_admin pode em QUALQUER usuário; tenant_admin só nos da PRÓPRIA loja.
CREATE OR REPLACE FUNCTION public.forcar_logout(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.users WHERE id = _user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado';
  END IF;

  IF public.is_super_admin() THEN
    NULL; -- super_admin: qualquer usuário
  ELSIF public.is_tenant_admin() AND v_tenant IS NOT NULL AND v_tenant = public.get_user_tenant_id() THEN
    NULL; -- tenant_admin: só a própria loja
  ELSE
    RAISE EXCEPTION 'Sem permissao para forcar logout deste usuario';
  END IF;

  -- Revoga as sessões: a próxima tentativa de refresh falha -> o app desloga.
  DELETE FROM auth.sessions WHERE user_id = _user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
END;
$$;

REVOKE ALL ON FUNCTION public.forcar_logout(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forcar_logout(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.forcar_logout(uuid) TO authenticated;
