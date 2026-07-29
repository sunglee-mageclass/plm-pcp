-- Plan. Tecido — prévia do pedido com MODELO DE SALDO por OC (bugs B/C + sobra; decisão do dono = "b").
--
-- Antes: o déficit descontava só `plan_tecido_ocs` (OCs geradas por ESTA coleção), por VARIANTE.
-- Problemas: (B) ignorava as OCs APLICADAS (`oc_aplicada`) → "a comprar" fantasma; (C) chave só por
-- variante vazava entre artigos (mesma variante em outro tecido).
--
-- Agora: déficit = necessidade(C) − SUPPLY(C), por (artigo_id, variante):
--   • OC "própria" de C (em plan_tecido_ocs): entra a metragem CHEIA (pedida).
--   • OC "aplicada" a C (em oc_aplicada, cujo dono é outra coleção): entra só a SOBRA
--     = max(0, pedida − necessidade do DONO) — assim o dono consome primeiro e a sobra é
--     reaproveitada, sem contar em dobro a parte que o dono já usa.
-- Necessidade é coleção-wide, então a sobra de uma OC já é compartilhada entre as subcoleções da
-- mesma coleção (o pedido do dono cobre a demanda inteira da coleção dona).
-- Helper `_plan_tecido_nec_variante_core` isola a necessidade (usada p/ C e p/ o dono das OCs).

BEGIN;

CREATE OR REPLACE FUNCTION public._plan_tecido_nec_variante_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(artigo_id uuid, variante_tecido_id uuid, nec_m numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select mt.artigo_id, vv.variante_tecido_id,
         sum(coalesce(mt.consumo,0) * coalesce(vv.grade_total,0) * coalesce(vv.multiplicador,1))::numeric as nec_m
  from plan_tecido p
  join plan_tecido_subcolecoes s on s.plan_id = p.id
  join plan_tecido_linhas l on l.sub_id = s.id
  join plan_tecido_slots sl on sl.linha_ref_id = l.id and coalesce(sl.usar_estoque,false) = false
  join plan_tecido_materiais mt on mt.slot_id = sl.id
  join plan_tecido_variantes vv on vv.material_id = mt.id
  where p.colecao_id = _colecao_id and p.tenant_id = _tenant
    and mt.artigo_id is not null and vv.variante_tecido_id is not null
  group by mt.artigo_id, vv.variante_tecido_id;
$function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_nec_variante_core(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._plan_tecido_previa_pedido_core(_tenant uuid, _colecao_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_res jsonb;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;

  with necessidade as (
    select n.artigo_id, n.variante_tecido_id, n.nec_m
    from public._plan_tecido_nec_variante_core(_tenant, _colecao_id) n
  ),
  est as ( select variante_tecido_id, previsto from public._estoque_tecido_core(_tenant) ),
  -- OCs ligadas a C: própria (plan_tecido_ocs) tem prioridade; aplicada (oc_aplicada) só se não for própria
  oc_link as (
    select po.oc_tecido_id, true as owned, po.colecao_id as owner_col
    from plan_tecido_ocs po where po.colecao_id = _colecao_id
    union
    select a.oc_tecido_id, false as owned,
           (select po2.colecao_id from plan_tecido_ocs po2 where po2.oc_tecido_id = a.oc_tecido_id limit 1) as owner_col
    from plan_tecido_oc_aplicada a
    where a.colecao_id = _colecao_id
      and not exists (select 1 from plan_tecido_ocs po3 where po3.oc_tecido_id = a.oc_tecido_id and po3.colecao_id = _colecao_id)
  ),
  oc_pedida as (  -- pedida por (oc, artigo, variante), kg→m
    select it.oc_tecido_id, it.artigo_id, it.variante_tecido_id,
           sum(case when ar.unidade_medida='kg' then coalesce(it.quantidade_pedida,0)*coalesce(ar.rendimento,0)
                    else coalesce(it.quantidade_pedida,0) end) as pedida_m
    from ocs_tecido oc
    join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false)=false and it.variante_tecido_id is not null
    join artigos ar on ar.id = it.artigo_id
    where oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
      and oc.id in (select oc_tecido_id from oc_link)
    group by it.oc_tecido_id, it.artigo_id, it.variante_tecido_id
  ),
  owner_nec as (  -- necessidade do DONO de cada OC aplicada (uma chamada por dono distinto)
    select o.owner_col, nn.artigo_id, nn.variante_tecido_id, nn.nec_m
    from (select distinct owner_col from oc_link where not owned and owner_col is not null) o
    cross join lateral public._plan_tecido_nec_variante_core(_tenant, o.owner_col) nn
  ),
  supply as (  -- cobertura por (artigo, variante): própria = pedida cheia; aplicada = sobra do dono
    select op.artigo_id, op.variante_tecido_id,
           sum(case when ol.owned then op.pedida_m
                    else greatest(0, op.pedida_m - coalesce(onec.nec_m, 0)) end) as supply_m
    from oc_pedida op
    join oc_link ol on ol.oc_tecido_id = op.oc_tecido_id
    left join owner_nec onec on onec.owner_col = ol.owner_col
      and onec.artigo_id = op.artigo_id and onec.variante_tecido_id = op.variante_tecido_id
    group by op.artigo_id, op.variante_tecido_id
  ),
  base as (
    select n.artigo_id, n.variante_tecido_id, n.nec_m,
           greatest(0, coalesce(e.previsto,0)) as estoque_m,
           round(greatest(0, n.nec_m - coalesce(sup.supply_m,0))::numeric, 4) as deficit_m,  -- necessidade − cobertura por OC (própria cheia + sobra da aplicada)
           a.nome as artigo_nome, a.unidade_medida, a.rendimento, a.empresa_id, a.representante_id,
           concat_ws(' - ', cor.nome, ap.nome) as label,  -- só cor base - apelido (item 15)
           coalesce(vt.preco, a.preco, 0) as preco
    from necessidade n
    join artigos a on a.id = n.artigo_id
    left join variantes_tecido vt on vt.id = n.variante_tecido_id
    left join cores cor on cor.id = vt.cor_id
    left join cores_apelido ap on ap.id = vt.cor_apelido_id
    left join est e on e.variante_tecido_id = n.variante_tecido_id
    left join supply sup on sup.artigo_id = n.artigo_id and sup.variante_tecido_id = n.variante_tecido_id  -- KEY (artigo, variante) [bug C]
  ),
  calc as (
    select *,
      case when deficit_m <= 0 then 0
           when unidade_medida = 'kg' then
             case when coalesce(rendimento,0) > 0 then ceil((deficit_m / rendimento) / 5.0) * 5 else null end
           else ceil(deficit_m / 10.0) * 10 end as qtd
    from base
  )
  select jsonb_build_object(
    'fornecedores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'empresa_id', emp_id, 'representante_id', rep_id,
        'empresa_nome', emp_nome, 'representante_nome', rep_nome,
        'itens', itens) order by emp_nome)
      from (
        select c.empresa_id as emp_id, c.representante_id as rep_id,
               e.nome_fantasia as emp_nome, r.nome as rep_nome,
               jsonb_agg(jsonb_build_object(
                 'artigo_id', c.artigo_id, 'artigo_nome', c.artigo_nome,
                 'unidade_medida', c.unidade_medida, 'rendimento', c.rendimento,
                 'variante_tecido_id', c.variante_tecido_id, 'label', c.label,
                 'necessidade_m', c.nec_m, 'estoque_m', c.estoque_m, 'deficit_m', c.deficit_m,
                 'qtd', c.qtd, 'unidade', coalesce(c.unidade_medida,'metro'), 'preco', c.preco)
                 order by c.artigo_nome, c.label) as itens
        from calc c
        left join empresas e on e.id = c.empresa_id
        left join representantes r on r.id = c.representante_id
        where c.empresa_id is not null and c.deficit_m > 0
        group by c.empresa_id, c.representante_id, e.nome_fantasia, r.nome
      ) f), '[]'::jsonb),
    'sem_fornecedor', coalesce((
      select jsonb_agg(distinct jsonb_build_object('artigo_id', c.artigo_id, 'artigo_nome', c.artigo_nome))
      from calc c where c.empresa_id is null and c.deficit_m > 0), '[]'::jsonb),
    'bloqueios', coalesce((
      select jsonb_agg(distinct jsonb_build_object('artigo_nome', c.artigo_nome, 'motivo', 'Artigo em kg sem rendimento cadastrado'))
      from calc c where c.unidade_medida = 'kg' and coalesce(c.rendimento,0) <= 0 and c.deficit_m > 0), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $function$;

COMMIT;
