BEGIN;

-- Subcategoria de tecido, Task 2: set_artigo_categorias passa a gravar a sub POR PAR (categoria, sub).
-- Assinatura muda: (uuid, uuid[]) -> (uuid, jsonb). DROP da antiga + CREATE da nova (sem overload: o front e o unico
-- chamador e migra no Task 4; manter as duas confundiria o PostgREST).
-- _pares = [{"categoria_tecido_id":"<uuid>","subcategoria_tecido_id":"<uuid>"|null}, ...]
-- Preserva integralmente a versao viva: SECURITY DEFINER, search_path=public, checagem de tenant, mensagens 'Sem tenant' /
-- 'Tecido não encontrado' e o portao B3 da S3c (so categoria da MESMA loja; a de outra loja e ignorada).
-- A coerencia sub<->categoria por linha vem do gatilho trg_act_sub_mesma_categoria (Task 1): P0001 subcategoria_categoria_diferente.
-- Atomico: delete-all + reinsert na mesma chamada (um par invalido derruba a txn inteira, o tecido nao fica sem categoria).

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.set_artigo_categorias(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.set_artigo_categorias(_artigo_id uuid, _pares jsonb)
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
  if _pares is not null and jsonb_typeof(_pares) = 'array' and jsonb_array_length(_pares) > 0 then
    insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id, subcategoria_tecido_id)
    -- [seg s3c] (Reforco de seguranca S3c, B3) so categoria da MESMA loja do tecido; a de outra loja (ou inexistente) e ignorada.
    -- DISTINCT ON: categoria repetida em _pares vira UM par (a 1a ocorrencia vale) - como o any(uuid[]) de antes, nao estoura a UNIQUE (artigo_id, categoria_tecido_id).
    select distinct on (ct.id) _artigo_id, ct.id, nullif(p.elem->>'subcategoria_tecido_id', '')::uuid
      from jsonb_array_elements(_pares) with ordinality as p(elem, ord)
      join public.categorias_tecido ct
        on ct.id = nullif(p.elem->>'categoria_tecido_id', '')::uuid and ct.tenant_id = v_tenant
     order by ct.id, p.ord;
  end if;
end $function$;

REVOKE EXECUTE ON FUNCTION public.set_artigo_categorias(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_artigo_categorias(uuid, jsonb) TO authenticated, service_role;

COMMIT;
