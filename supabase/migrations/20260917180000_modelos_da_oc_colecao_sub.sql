-- Modelos que usam uma OC (dialog do Modo Plano) — set/2026: acrescenta colecao_id + subcolecao ao
-- retorno, p/ o dialog exibir a subcoleção E o card virar um deep-link ("deseja ser redirecionado
-- para este produto?" → /criacao/plan-tecido?colecao=&sub=&modo=plano&focoModelo=). Aditivo à RPC
-- `plan_tecido_modelos_da_oc` (migration 20260917140000); mesma união de fontes, mesmo REVOKE/guarda.

-- Muda o RETURNS TABLE (colunas novas) → REPLACE não basta, tem que dropar a versão antiga primeiro.
-- `subcolecao_id` (uuid da colecao_subcolecoes) é p/ o DEEP-LINK (?sub= casa contra subcolecao_id, NÃO
-- o nome); `subcolecao` (texto) é só p/ EXIBIR. `modelos.subcolecao` guarda o NOME → mapeia p/ o id via
-- colecao_subcolecoes por (colecao_id, nome).
DROP FUNCTION IF EXISTS public._plan_tecido_modelos_da_oc_core(uuid, uuid);
CREATE OR REPLACE FUNCTION public._plan_tecido_modelos_da_oc_core(_tenant uuid, _oc_id uuid)
 RETURNS TABLE(modelo_id uuid, ref text, nome text, thumb_path text,
               colecao_id uuid, colecao_nome text, subcolecao_id uuid, subcolecao text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select tenant_id from ocs_tecido where id = _oc_id) is distinct from _tenant then
    raise exception 'OC de outra loja.' using errcode = '42501';
  end if;

  return query
  with modelo_ids as (
    -- 1. vínculo do Dev (por item da OC)
    select distinct l.modelo_id
      from modelo_tecido_oc_links l
      join ocs_tecido_itens it on it.id = l.oc_tecido_item_id
     where it.oc_tecido_id = _oc_id
    union
    -- 2. hint de OC no card do plano (slot → modelo)
    select distinct s.modelo_id
      from plan_tecido_slot_oc so
      join plan_tecido_slots s on s.id = so.slot_id
     where so.oc_tecido_id = _oc_id and s.modelo_id is not null
  )
  select m.id as modelo_id,
         m.ref::text,
         m.nome::text,
         coalesce((m.fotos_modelo)[1], m.desenho_tecnico_url, m.croqui_url)::text as thumb_path,
         m.colecao_id,
         c.nome::text as colecao_nome,
         sc.id as subcolecao_id,          -- uuid p/ o deep-link (?sub= casa contra subcolecao_id)
         m.subcolecao::text as subcolecao -- nome p/ exibir
    from modelo_ids mi
    join modelos m on m.id = mi.modelo_id and m.tenant_id = _tenant
    left join colecoes c on c.id = m.colecao_id
    left join colecao_subcolecoes sc on sc.colecao_id = m.colecao_id
      and sc.nome = m.subcolecao and sc.tenant_id = _tenant
   order by c.nome nulls last, m.subcolecao nulls last, m.nome;
end $function$;

-- Wrapper com a assinatura de retorno nova (o RETURNS TABLE mudou → recria o wrapper também).
DROP FUNCTION IF EXISTS public.plan_tecido_modelos_da_oc(uuid);
CREATE OR REPLACE FUNCTION public.plan_tecido_modelos_da_oc(_oc_id uuid)
 RETURNS TABLE(modelo_id uuid, ref text, nome text, thumb_path text,
               colecao_id uuid, colecao_nome text, subcolecao_id uuid, subcolecao text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query select * from public._plan_tecido_modelos_da_oc_core(get_user_tenant_id(), _oc_id);
end $function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_modelos_da_oc_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_modelos_da_oc(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_modelos_da_oc(uuid) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');
