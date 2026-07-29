-- "Situação da OC" (Plan. Tecido): agrupar a linha pelo ARTIGO REAL da variante, não pelo artigo
-- gravado no item da OC. Havia itens com artigo TROCADO vs a variante (o mesmo cross-artigo do BOM:
-- ex. item com artigo "Fiore" mas variante de "Malha Tessa", e vice-versa) → a variante aparecia no
-- tecido ERRADO no Resumo/Drawer. A variante é a fonte da verdade do tecido (variantes_tecido.artigo_id).
--
-- Só muda a AGRUPAÇÃO (artigo_id/artigo_nome de saída). A conversão kg→m de pedida/entregue continua
-- pelo artigo DO ITEM (ar), pois a quantidade foi gravada na unidade daquele artigo — não recalcula
-- número, só coloca a variante embaixo do tecido certo. (Corrigir o it.artigo_id na origem — "Fazer
-- pedido" e itens legados — é fix de dado separado.)

BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_situacao_ocs_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(oc_tecido_id uuid, numero text, data_pedido date, status text, artigo_id uuid, artigo_nome text, variante_tecido_id uuid, variante_label text, pedida_m numeric, entregue_m numeric, usada_m numeric)
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
         -- TECIDO = artigo REAL da variante (não o artigo do item, que pode estar trocado)
         coalesce(vt.artigo_id, it.artigo_id) as artigo_id,
         coalesce(avt.nome, ar.nome)::text as artigo_nome,
         it.variante_tecido_id,
         concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome) as variante_label,
         -- conversão pela unidade do artigo DO ITEM (a quantidade foi gravada nessa unidade)
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
  left join artigos avt on avt.id = vt.artigo_id
  left join cores cor on cor.id = vt.cor_id
  left join cores_apelido ap on ap.id = vt.cor_apelido_id
  left join lateral (
    select coalesce(sum(b.quantidade),0) as usada
    from estoque_tecido_baixas b where b.oc_tecido_item_id = it.id
  ) bx on true;
end $function$;

COMMIT;
