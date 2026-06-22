-- Código padrão (default, editável) do rolo: R{seq4}{Categoria}{AAMMDD}.
-- Categoria = 1ª letra da categoria do tecido (categorias_tecido). Sequência = nº
-- de rolos do tenant + 1. Editável no front (só sugestão p/ evitar duplicatas).
CREATE OR REPLACE FUNCTION public.proximo_codigo_rolo(_artigo_id uuid DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_cat text := '';
  v_seq int;
BEGIN
  IF v_tenant IS NULL THEN RETURN ''; END IF;
  IF _artigo_id IS NOT NULL THEN
    SELECT UPPER(LEFT(COALESCE(ct.nome, ''), 1)) INTO v_cat
    FROM public.artigos a
    LEFT JOIN public.categorias_tecido ct ON ct.id = a.categoria_tecido_id
    WHERE a.id = _artigo_id;
  END IF;
  SELECT count(*) + 1 INTO v_seq FROM public.ocs_tecido WHERE tenant_id = v_tenant AND is_rolo = true;
  RETURN 'R' || LPAD(v_seq::text, 4, '0') || COALESCE(v_cat, '')
         || to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYMMDD');
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.proximo_codigo_rolo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.proximo_codigo_rolo(uuid) TO authenticated;
