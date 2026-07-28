-- Plan. Tecido — Fase 2: a prévia do pedido passa a usar a GRADE PRÓPRIA do forro
-- (não mais a grade do Tecido 1 via "D8"/multiplicador).
--
-- Contexto: o front (necessidadePorTecido em src/lib/plan-tecido/calc.ts) já calcula a
-- necessidade do forro por `variante.grade_total` própria (cada forro tem sua grade, editável
-- no MaterialBlock). O servidor, porém, ainda computava o forro como consumo × grade_total do
-- Tecido 1 (slot_tec1 = "D8"), o que INFLAVA o déficit do forro e fazia o "Fazer pedido" pedir
-- mais do que o Resumo dizia (ex.: Resort 27 → forro pedia 2172 m em vez de 814 m).
--
-- Fix cirúrgico e idempotente: CREATE OR REPLACE só do _core da prévia. Removida a CTE slot_tec1
-- (e seu join), e o forro passa a usar coalesce(vv.grade_total,0) igual ao tecido — mesma fórmula
-- do front (consumo × grade_total própria × multiplicador). Wrapper e ACLs inalterados.

BEGIN;

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

  with necessidade as (  -- só slots ENCOMENDA (usar_estoque=false); SEM perda
    select mt.artigo_id, vv.variante_tecido_id,
           sum(coalesce(mt.consumo,0)
               * coalesce(vv.grade_total,0)          -- forro e tecido: grade PRÓPRIA da variante
               * coalesce(vv.multiplicador,1)) as nec_m
    from plan_tecido p
    join plan_tecido_subcolecoes s on s.plan_id = p.id
    join plan_tecido_linhas l on l.sub_id = s.id
    join plan_tecido_slots sl on sl.linha_ref_id = l.id and coalesce(sl.usar_estoque,false) = false
    join plan_tecido_materiais mt on mt.slot_id = sl.id
    join plan_tecido_variantes vv on vv.material_id = mt.id
    where p.colecao_id = _colecao_id and p.tenant_id = _tenant
      and mt.artigo_id is not null and vv.variante_tecido_id is not null
    group by mt.artigo_id, vv.variante_tecido_id
  ),
  est as ( select variante_tecido_id, previsto from public._estoque_tecido_core(_tenant) ),
  ja_pedido as (  -- o que ESTE plano já pediu (plan_tecido_ocs); OC excluída some por cascade
    select it.variante_tecido_id,
           sum(case when a.unidade_medida = 'kg' then coalesce(it.quantidade_pedida,0) * coalesce(a.rendimento,0)
                    else coalesce(it.quantidade_pedida,0) end) as m
    from plan_tecido_ocs po
    join ocs_tecido oc on oc.id = po.oc_tecido_id and oc.tenant_id = _tenant and not coalesce(oc.is_rolo,false)
    join ocs_tecido_itens it on it.oc_tecido_id = oc.id
    join artigos a on a.id = it.artigo_id
    where po.colecao_id = _colecao_id and coalesce(it.cancelado,false) = false and it.variante_tecido_id is not null
    group by it.variante_tecido_id
  ),
  base as (
    select n.artigo_id, n.variante_tecido_id, n.nec_m,
           greatest(0, coalesce(e.previsto,0)) as estoque_m,
           round(greatest(0, n.nec_m - coalesce(jp.m,0))::numeric, 4) as deficit_m,  -- necessidade cheia − já pedido por ESTE plano (ignora estoque geral)
           a.nome as artigo_nome, a.unidade_medida, a.rendimento, a.empresa_id, a.representante_id,
           concat_ws(' - ', vt.nome_variante, cor.nome, ap.nome) as label,
           coalesce(vt.preco, a.preco, 0) as preco
    from necessidade n
    join artigos a on a.id = n.artigo_id
    left join variantes_tecido vt on vt.id = n.variante_tecido_id
    left join cores cor on cor.id = vt.cor_id
    left join cores_apelido ap on ap.id = vt.cor_apelido_id
    left join est e on e.variante_tecido_id = n.variante_tecido_id
    left join ja_pedido jp on jp.variante_tecido_id = n.variante_tecido_id
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
