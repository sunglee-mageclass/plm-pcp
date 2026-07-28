-- Plan. Tecido — Fase 3: RPC read-only "Situação da OC" por variante (escopo = OCs da coleção)
--
-- Devolve, por variante_tecido_id, o total PEDIDO e RECEBIDO somando SÓ as OCs vinculadas a esta
-- coleção (plan_tecido_ocs = geradas pelo "Fazer pedido" ∪ plan_tecido_oc_aplicada = aplicadas à mão).
-- kg → metros via artigos.rendimento (mesma convenção da prévia). Rolos e itens cancelados ficam fora.
--
-- O front combina isso com a NECESSIDADE do plano (reservada = nec dos cards) para exibir a
-- "sobra prevista" = pedida − reservada (pode ser NEGATIVA enquanto se planeja — sinal de que
-- falta pedir). Nada aqui toca o ledger de baixa; é leitura pura.
--
-- Padrão wrapper + _core (invariante #9): wrapper checa módulo 'criacao' e passa
-- get_user_tenant_id(); _core tem EXECUTE revogado de PUBLIC/anon/authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_situacao_ocs_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(variante_tecido_id uuid, pedida_m numeric, recebida_m numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;

  return query
  with ocs as (
    select o.oc_tecido_id from plan_tecido_ocs o where o.colecao_id = _colecao_id and o.tenant_id = _tenant
    union
    select a.oc_tecido_id from plan_tecido_oc_aplicada a where a.colecao_id = _colecao_id and a.tenant_id = _tenant
  )
  select it.variante_tecido_id,
         sum(case when ar.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0) * coalesce(ar.rendimento,0)
                  else coalesce(it.quantidade_pedida,0) end)::numeric as pedida_m,
         sum(case when ar.unidade_medida = 'kg' then coalesce(it.quantidade_recebida,0) * coalesce(ar.rendimento,0)
                  else coalesce(it.quantidade_recebida,0) end)::numeric as recebida_m
  from ocs
  join ocs_tecido oc on oc.id = ocs.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
  join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
  join artigos ar on ar.id = it.artigo_id
  group by it.variante_tecido_id;
end $function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_situacao_ocs_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.plan_tecido_situacao_ocs(_colecao_id uuid)
 RETURNS TABLE(variante_tecido_id uuid, pedida_m numeric, recebida_m numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return query select * from public._plan_tecido_situacao_ocs_core(public.get_user_tenant_id(), _colecao_id);
end $function$;

COMMIT;
