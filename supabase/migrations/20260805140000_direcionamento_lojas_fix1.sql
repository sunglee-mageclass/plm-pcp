-- Direcionamento multi-lojas — fix round 1 (review da Task 2), 1 achado HIGH:
-- `excluir_loja_direcionamento` é SECURITY DEFINER (bypassa RLS, owner postgres) e tinha
-- GRANT a authenticated — qualquer usuário não-admin do tenant conseguia excluir loja livre,
-- exatamente o que o fix1 da Task 1 restringiu a tenant_admin/super_admin na RLS de
-- lojas_direcionamento. Corrige adicionando a MESMA checagem no início da função (a RLS não
-- se aplica dentro de SECURITY DEFINER, então tem que ser explícita). Resto do corpo
-- preservado BYTE A BYTE (diff-validado via pg_get_functiondef antes/depois).
BEGIN;

CREATE OR REPLACE FUNCTION public.excluir_loja_direcionamento(_loja_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_nome text; v_default boolean; v_n int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode excluir lojas de direcionamento';
  END IF;
  SELECT nome, is_default INTO v_nome, v_default
    FROM public.lojas_direcionamento WHERE id = _loja_id AND tenant_id = v_tenant;
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Loja não encontrada'; END IF;
  IF v_default THEN
    RAISE EXCEPTION 'A loja padrão ("%") não pode ser excluída — renomeie ou desative-a.', v_nome;
  END IF;
  SELECT count(*) INTO v_n FROM public.direcionamento_lojas WHERE loja_id = _loja_id;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Não é possível excluir a loja "%": ela tem % linha(s) de direcionamento. Desative-a para escondê-la de novos direcionamentos.', v_nome, v_n;
  END IF;
  DELETE FROM public.lojas_direcionamento WHERE id = _loja_id AND tenant_id = v_tenant;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.excluir_loja_direcionamento(uuid) FROM anon;

COMMIT;
SELECT pg_notify('pgrst', 'reload schema');
