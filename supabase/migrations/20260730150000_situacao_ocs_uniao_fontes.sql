-- Situação da OC (Plan. Tecido): a lista de OCs do plano tinha 3 fontes divergentes —
-- a RPC só via plan_tecido_ocs ∪ oc_aplicada, enquanto a conta de reserva do front também
-- conta vínculos do Dev (modelo_tecido_oc_links) e hints de slot (plan_tecido_slot_oc).
-- Resultado: OC reservando metros sem aparecer (Ave Rara/Resort 27: ANGELIM invisível).
-- Decisão do dono (30/07/2026): UNIÃO das 3 fontes.
CREATE OR REPLACE FUNCTION public._plan_tecido_situacao_ocs_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(oc_tecido_id uuid, numero text, data_pedido date, status text, artigo_id uuid, artigo_nome text, variante_tecido_id uuid, variante_label text, pedida_m numeric, entregue_m numeric, usada_m numeric, comprometida_m numeric)
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
    union
    -- OCs vinculadas via DESENVOLVIMENTO (modelo_tecido_oc_links): reservam metros no plano
    -- mas ficavam INVISÍVEIS aqui (auditoria jul/2026 — Ave Rara: ANGELIM sumia do Resumo).
    select it2.oc_tecido_id
      from modelo_tecido_oc_links l
      join modelos m on m.id = l.modelo_id and m.colecao_id = _colecao_id and m.tenant_id = _tenant
      join ocs_tecido_itens it2 on it2.id = l.oc_tecido_item_id
    union
    -- OCs apontadas por HINT de slot do plano (plan_tecido_slot_oc)
    select so.oc_tecido_id from plan_tecido_slot_oc so
     where so.colecao_id = _colecao_id and so.tenant_id = _tenant
  )
  select oc.id as oc_tecido_id,
         oc.numero_pedido::text as numero,
         oc.data_pedido,
         oc.status::text as status,
         coalesce(vt.artigo_id, it.artigo_id) as artigo_id,   -- tecido = artigo REAL da variante
         coalesce(avt.nome, ar.nome)::text as artigo_nome,
         it.variante_tecido_id,
         concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome) as variante_label,
         (case when ar.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0) * coalesce(ar.rendimento,0)
               else coalesce(it.quantidade_pedida,0) end)::numeric as pedida_m,
         (case when ar.unidade_medida = 'kg' then coalesce(it.quantidade_recebida,0) * coalesce(ar.rendimento,0)
               else coalesce(it.quantidade_recebida,0) end)::numeric as entregue_m,
         coalesce(bx.usada,0)::numeric as usada_m,             -- pt2 baixa real (vermelho)
         coalesce(cm.comprometida,0)::numeric as comprometida_m  -- pt1 enviado à explosão (laranja)
  from ocs
  join ocs_tecido oc on oc.id = ocs.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
  join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
  join artigos ar on ar.id = it.artigo_id
  left join variantes_tecido vt on vt.id = it.variante_tecido_id
  left join artigos avt on avt.id = vt.artigo_id
  left join cores cor on cor.id = vt.cor_id
  left join cores_apelido ap on ap.id = vt.cor_apelido_id
  left join lateral (
    select coalesce(sum(b.quantidade),0) as usada
    from estoque_tecido_baixas b where b.oc_tecido_item_id = it.id
  ) bx on true
  left join lateral (
    -- uso PLANEJADO: vínculos desta OC-item de modelos ENVIADOS À EXPLOSÃO (enviado_cad)
    select coalesce(sum(l.quantidade_m),0) as comprometida
    from modelo_tecido_oc_links l
    join modelos m on m.id = l.modelo_id
    where l.oc_tecido_item_id = it.id and coalesce(m.enviado_cad,false) = true
  ) cm on true;
end $function$;
