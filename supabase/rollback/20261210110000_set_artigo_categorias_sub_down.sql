-- Inverso da 20261210110000: volta a versao (uuid, uuid[]) EXATA do corpo vivo (pg_get_functiondef de 19/11/2026) e dropa a jsonb.
-- ATENCAO: a versao uuid[] nao grava a sub; as subcategorias ja gravadas em artigo_categorias_tecido ficam (so deixam de ser editadas por esta RPC).
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.set_artigo_categorias(uuid, jsonb);
CREATE OR REPLACE FUNCTION public.set_artigo_categorias(_artigo_id uuid, _cat_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if not exists (select 1 from artigos where id = _artigo_id and tenant_id = v_tenant) then
    raise exception 'Tecido não encontrado';
  end if;
  delete from artigo_categorias_tecido where artigo_id = _artigo_id;
  if array_length(_cat_ids, 1) is not null then
    insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id)
    -- [seg s3c] (Reforco de seguranca S3c, B3) so categoria da MESMA loja do tecido; a de outra loja (ou inexistente) e ignorada.
    select _artigo_id, ct.id from public.categorias_tecido ct
     where ct.id = any (_cat_ids) and ct.tenant_id = v_tenant;
  end if;
end $function$

;
-- ACL viva: {postgres=X, authenticated=X, service_role=X} (sem anon).
REVOKE EXECUTE ON FUNCTION public.set_artigo_categorias(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_artigo_categorias(uuid, uuid[]) TO authenticated, service_role;
COMMIT;
