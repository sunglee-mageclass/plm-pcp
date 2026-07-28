-- Plan. Tecido — Fase 3 (correção p/ o mockup): "Situação da OC" é POR OC (não por tecido solto).
--
-- Reescreve plan_tecido_situacao_ocs para devolver UMA LINHA POR ITEM DE OC (oc × artigo × variante)
-- das OCs vinculadas à coleção (plan_tecido_ocs ∪ plan_tecido_oc_aplicada), com:
--   pedida_m   = quantidade_pedida   (kg→m via rendimento)
--   entregue_m = quantidade_recebida (kg→m via rendimento)
--   usada_m    = Σ baixas do ledger daquele item (estoque_tecido_baixas.quantidade já está em METROS —
--                _estoque_tecido_core faz fisico = recebido_m − Σbaixa sem reconverter).
-- Mais metadados da OC (numero, data_pedido, status) e rótulos (artigo_nome, variante_label) para os
-- quadros "Situação da OC — por OC" e os subsheets por tecido/variante.
--
-- A "reservada" e a "sobra prevista" (= pedida − reservada, pode ser negativa) são calculadas AO VIVO
-- no front, a partir da demanda dos cards atribuídos a cada OC — não entram aqui.
--
-- Troca de assinatura → DROP + CREATE (idempotente). Padrão wrapper('criacao') + _core REVOKE (#9).

BEGIN;

DROP FUNCTION IF EXISTS public.plan_tecido_situacao_ocs(uuid);
DROP FUNCTION IF EXISTS public._plan_tecido_situacao_ocs_core(uuid, uuid);

CREATE FUNCTION public._plan_tecido_situacao_ocs_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(
   oc_tecido_id uuid, numero text, data_pedido date, status text,
   artigo_id uuid, artigo_nome text, variante_tecido_id uuid, variante_label text,
   pedida_m numeric, entregue_m numeric, usada_m numeric)
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
  select oc.id as oc_tecido_id,
         oc.numero_pedido::text as numero,
         oc.data_pedido,
         oc.status::text as status,
         it.artigo_id,
         ar.nome::text as artigo_nome,
         it.variante_tecido_id,
         concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome) as variante_label,
         (case when ar.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0) * coalesce(ar.rendimento,0)
               else coalesce(it.quantidade_pedida,0) end)::numeric as pedida_m,
         (case when ar.unidade_medida = 'kg' then coalesce(it.quantidade_recebida,0) * coalesce(ar.rendimento,0)
               else coalesce(it.quantidade_recebida,0) end)::numeric as entregue_m,
         coalesce(bx.usada,0)::numeric as usada_m
  from ocs
  join ocs_tecido oc on oc.id = ocs.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
  join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
  join artigos ar on ar.id = it.artigo_id
  left join variantes_tecido vt on vt.id = it.variante_tecido_id
  left join cores cor on cor.id = vt.cor_id
  left join cores_apelido ap on ap.id = vt.cor_apelido_id
  left join lateral (
    select coalesce(sum(b.quantidade),0) as usada
    from estoque_tecido_baixas b where b.oc_tecido_item_id = it.id
  ) bx on true;
end $function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_situacao_ocs_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.plan_tecido_situacao_ocs(_colecao_id uuid)
 RETURNS TABLE(
   oc_tecido_id uuid, numero text, data_pedido date, status text,
   artigo_id uuid, artigo_nome text, variante_tecido_id uuid, variante_label text,
   pedida_m numeric, entregue_m numeric, usada_m numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return query select * from public._plan_tecido_situacao_ocs_core(public.get_user_tenant_id(), _colecao_id);
end $function$;

COMMIT;
