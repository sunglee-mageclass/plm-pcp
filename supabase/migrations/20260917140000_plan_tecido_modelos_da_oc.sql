-- Modelos que usam uma OC (dialog "OCs vinculadas" do Modo Plano) — set/2026.
-- A lista antiga só olhava a subcoleção ativa da coleção aberta, mas os números Pedido/Reserva/Sobra
-- do dialog já são GLOBAIS (a reserva conta o comprometido/baixa de QUALQUER coleção — ver
-- _plan_tecido_situacao_ocs_core: os laterais `bx`/`cm` não filtram por coleção). Descompasso: a
-- Sobra refletia reserva de modelos que a lista não mostrava. Decisão do dono (set/2026): a lista
-- passa a ser GLOBAL — todos os modelos que reservam desta OC, em qualquer coleção/subcoleção — pra
-- explicar a Sobra real.
--
-- Fontes de vínculo modelo↔OC (as MESMAS que geram a reserva na situação):
--   1. modelo_tecido_oc_links  — vínculo do Desenvolvimento por item de OC (gera `comprometida`).
--   2. plan_tecido_slot_oc      — hint de OC no card do plano; leva ao modelo via plan_tecido_slots.
-- (plan_tecido_oc_aplicada é aplicação no NÍVEL da coleção, sem modelo — não entra na lista.)
--
-- Tenant-scoped; wrapper + _core com EXECUTE revogado dos TRÊS (invariante #9). O `_oc_id` é validado
-- contra o tenant do chamador (a OC tem que ser da loja) — evita IDOR de leitura cross-tenant.

CREATE OR REPLACE FUNCTION public._plan_tecido_modelos_da_oc_core(_tenant uuid, _oc_id uuid)
 RETURNS TABLE(modelo_id uuid, ref text, nome text, thumb_path text, colecao_nome text)
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
         c.nome::text as colecao_nome
    from modelo_ids mi
    join modelos m on m.id = mi.modelo_id and m.tenant_id = _tenant
    left join colecoes c on c.id = m.colecao_id
   order by c.nome nulls last, m.nome;
end $function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_modelos_da_oc_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Wrapper: injeta o tenant do chamador (jamais confiado do cliente) e delega ao _core.
CREATE OR REPLACE FUNCTION public.plan_tecido_modelos_da_oc(_oc_id uuid)
 RETURNS TABLE(modelo_id uuid, ref text, nome text, thumb_path text, colecao_nome text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query select * from public._plan_tecido_modelos_da_oc_core(get_user_tenant_id(), _oc_id);
end $function$;
