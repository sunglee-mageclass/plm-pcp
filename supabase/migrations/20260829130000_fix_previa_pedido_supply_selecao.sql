-- Fix (achado da revisão G5, MÉDIO): pedido POR SELEÇÃO sub-encomendava.
--
-- BUG: na CTE `supply`, a OC PRÓPRIA da coleção creditava a `pedida_m` INTEIRA
-- (`when ol.owned then op.pedida_m`). Com `_slot_ids` (pedido por seleção), a
-- `necessidade` = só os slots selecionados, MAS as OCs próprias (compradas antes
-- para OUTROS cards da coleção) creditavam a pedida cheia contra essa necessidade
-- parcial → déficit a MENOS → o wizard dizia "coberto" e não deixava pedir.
-- Ex.: card A (nec 100m) já comprado com OC própria de 100m; seleciono card C
-- (nec 50m, MESMA variante) → déficit saía max(0, 50−100) = 0 ("coberto"), mas
-- faltam 50m — a OC de 100m não sobra: ela já cobre o card A.
--
-- FIX: crédito PRÓPRIO (OC própria + SALDO de rolo próprio, POOL agregado por
-- artigo×variante) = greatest(0, Σ pedida própria + Σ saldo de rolo próprio
--                                − nec(slots NÃO selecionados da própria coleção, mesma variante)).
-- • POOL (e não por-OC): com 2+ OCs próprias, subtrair a nec_nonsel de CADA uma
--   sub-creditaria (déficit a MAIS). greatest(0,·) uma vez sobre a soma.
-- • Rolo próprio entra no MESMO pool (senão a nec_nonsel seria subtraída 2×,
--   uma da OC e outra do rolo — sub-crédito).
-- • nec_nonsel reusa `_plan_tecido_nec_variante_core` com o array COMPLEMENTAR
--   (slots da coleção fora de `_slot_ids`) — SSOT da fórmula de necessidade.
-- • `_slot_ids IS NULL` (coleção inteira) DEGENERA no comportamento atual:
--   nonsel vazio → nec_nonsel 0 → crédito cheio (byte-a-byte na conta).
-- • OC NÃO-própria (sobra do dono, Opção B) e rolo NÃO-próprio: INALTERADOS.
-- • `estoque_m` exibido segue greatest(0, previsto − rolo_m TOTAL): inalterado.
--
-- Mesma assinatura → CREATE OR REPLACE (sem DROP; ACL preservada). Re-REVOKE
-- defensivo no fim (invariante #9), idempotente.

CREATE OR REPLACE FUNCTION public._plan_tecido_previa_pedido_core(_tenant uuid, _colecao_id uuid, _slot_ids uuid[] DEFAULT NULL)
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
    from public._plan_tecido_nec_variante_core(_tenant, _colecao_id, _slot_ids) n  -- [G5] necessidade só dos slots selecionados (NULL = todos)
  ),
  nonsel as (  -- [FIX seleção] necessidade dos slots NÃO selecionados da PRÓPRIA coleção, por (artigo, variante):
               -- é o que as OCs/rolos PRÓPRIOS já têm de compromisso antes de sobrar pra seleção.
               -- `_slot_ids` NULL → CTE vazia (nec_nonsel 0) → crédito cheio (comportamento antigo).
    select nn.artigo_id, nn.variante_tecido_id, nn.nec_m
    from public._plan_tecido_nec_variante_core(
           _tenant, _colecao_id,
           (select coalesce(array_agg(sl.id), '{}'::uuid[])
              from plan_tecido p
              join plan_tecido_subcolecoes s on s.plan_id = p.id
              join plan_tecido_linhas l on l.sub_id = s.id
              join plan_tecido_slots sl on sl.linha_ref_id = l.id
             where p.colecao_id = _colecao_id and p.tenant_id = _tenant
               and not (sl.id = any(_slot_ids)))) nn
    where _slot_ids is not null
  ),
  est as ( select variante_tecido_id, previsto from public._estoque_tecido_core(_tenant) ),
  -- OCs ligadas a C: própria (plan_tecido_ocs) tem prioridade; NÃO-própria (aplicada/vínculo/hint)
  -- só se não for própria. has_card = a OC tem USO PLANEJADO REAL desta coleção (card do Dev vinculado
  -- OU hint de slot) — a "aplicada" pura (só marcada no seletor) tem has_card=false. Opção B: cobertura
  -- de OC não-própria só sai quando has_card (ver CTE supply). Decisão do dono ago/2026.
  oc_link as (
    select po.oc_tecido_id, true as owned, po.colecao_id as owner_col, true as has_card
    from plan_tecido_ocs po where po.colecao_id = _colecao_id
    union
    -- Fontes de vínculo (mesma união da RPC de situação, auditoria jul/2026): aplicada + vínculos do
    -- Dev (modelo_tecido_oc_links) + hints de slot. Todas entram como NÃO-próprias; cobertura = SOBRA
    -- do dono (pedida − necessidade da coleção dona) — MAS só quando has_card (uso real). owner_col NULL
    -- = OC órfã (sem dona); com card ⇒ pedida cheia (owner_nec 0), sem card ⇒ 0.
    select x.oc_tecido_id, false as owned,
           (select po2.colecao_id from plan_tecido_ocs po2 where po2.oc_tecido_id = x.oc_tecido_id limit 1) as owner_col,
           x.has_card
    from (
      select s.oc_tecido_id, bool_or(s.has_card) as has_card
      from (
        select a.oc_tecido_id, false as has_card   -- aplicada pura = acompanhamento (sem uso real)
          from plan_tecido_oc_aplicada a
         where a.colecao_id = _colecao_id and a.tenant_id = _tenant
        union all
        select it2.oc_tecido_id, true as has_card   -- card do Dev vinculado a esta OC
          from modelo_tecido_oc_links l
          join modelos m on m.id = l.modelo_id and m.colecao_id = _colecao_id and m.tenant_id = _tenant
          join ocs_tecido_itens it2 on it2.id = l.oc_tecido_item_id
        union all
        select so.oc_tecido_id, true as has_card    -- hint de slot (uso planejado no card)
          from plan_tecido_slot_oc so
         where so.colecao_id = _colecao_id and so.tenant_id = _tenant
      ) s
      group by s.oc_tecido_id
    ) x
    where not exists (select 1 from plan_tecido_ocs po3 where po3.oc_tecido_id = x.oc_tecido_id and po3.colecao_id = _colecao_id)
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
  supply as (  -- cobertura por (artigo, variante), SEPARADA em própria × não-própria:
               -- própria (own_m) = Σ pedida das OCs da coleção — o crédito efetivo (sobra p/ a
               -- seleção) é aplicado na CTE base, agregado com o rolo próprio [FIX seleção];
               -- NÃO-própria (nonown_m) só credita com USO PLANEJADO REAL (has_card) — aí = sobra
               -- do dono. Sem card → 0 (só acompanhamento). Opção B, decisão do dono ago/2026.
    select op.artigo_id, op.variante_tecido_id,
           coalesce(sum(op.pedida_m) filter (where ol.owned), 0) as own_m,
           coalesce(sum(greatest(0, op.pedida_m - coalesce(onec.nec_m, 0)))
                    filter (where not ol.owned and ol.has_card), 0) as nonown_m
    from oc_pedida op
    join oc_link ol on ol.oc_tecido_id = op.oc_tecido_id
    left join owner_nec onec on onec.owner_col = ol.owner_col
      and onec.artigo_id = op.artigo_id and onec.variante_tecido_id = op.variante_tecido_id
    group by op.artigo_id, op.variante_tecido_id
  ),
  rolo_supply as (  -- SALDO do rolo VINCULADO (pedida − separacao_rolo já feita) credita cobertura como OC.
                    -- rolo_m = TOTAL (abate do estoque exibido, inalterado); rolo_own_m = só rolos PRÓPRIOS
                    -- (plan_tecido_ocs desta coleção) — entram no pool próprio do [FIX seleção].
    select it.artigo_id, it.variante_tecido_id,
           sum(greatest(0,
             (case when ar.unidade_medida='kg' then coalesce(it.quantidade_pedida,0)*coalesce(ar.rendimento,0)
                   else coalesce(it.quantidade_pedida,0) end)
             - coalesce((select sum(b.quantidade) from estoque_tecido_baixas b
                          where b.rolo_id = oc.id and b.origem = 'separacao_rolo'), 0)
           )) as rolo_m,
           coalesce(sum(greatest(0,
             (case when ar.unidade_medida='kg' then coalesce(it.quantidade_pedida,0)*coalesce(ar.rendimento,0)
                   else coalesce(it.quantidade_pedida,0) end)
             - coalesce((select sum(b.quantidade) from estoque_tecido_baixas b
                          where b.rolo_id = oc.id and b.origem = 'separacao_rolo'), 0)
           )) filter (where ol.owned), 0) as rolo_own_m
    from oc_link ol
    join ocs_tecido oc on oc.id = ol.oc_tecido_id and oc.tenant_id = _tenant and coalesce(oc.is_rolo,false)
    join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false)=false and it.variante_tecido_id is not null
    join artigos ar on ar.id = it.artigo_id
    group by it.artigo_id, it.variante_tecido_id
  ),
  base as (
    select n.artigo_id, n.variante_tecido_id, n.nec_m,
           greatest(0, coalesce(e.previsto,0) - coalesce(rs.rolo_m,0)) as estoque_m,  -- rolo vinculado sai do estoque → vira cobertura
           -- déficit = nec da seleção
           --   − crédito PRÓPRIO agregado (OC própria + saldo de rolo próprio, POOL) já descontada a
           --     necessidade dos slots NÃO selecionados [FIX seleção; _slot_ids NULL → desconto 0]
           --   − sobra de OC não-própria − saldo de rolo não-próprio (inalterados)
           round(greatest(0, n.nec_m
             - greatest(0, coalesce(sup.own_m,0) + coalesce(rs.rolo_own_m,0) - coalesce(ns.nec_m,0))
             - coalesce(sup.nonown_m,0)
             - (coalesce(rs.rolo_m,0) - coalesce(rs.rolo_own_m,0))
           )::numeric, 4) as deficit_m,
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
    left join rolo_supply rs on rs.artigo_id = n.artigo_id and rs.variante_tecido_id = n.variante_tecido_id
    left join nonsel ns on ns.artigo_id = n.artigo_id and ns.variante_tecido_id = n.variante_tecido_id
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
    'cobertura', coalesce((
      select jsonb_agg(jsonb_build_object(
        'artigo_id', c.artigo_id, 'artigo_nome', c.artigo_nome,
        'variante_tecido_id', c.variante_tecido_id, 'label', c.label,
        'nec_m', c.nec_m, 'estoque_m', c.estoque_m, 'deficit_m', c.deficit_m)
        order by c.artigo_nome, c.label)
      from calc c), '[]'::jsonb),
    'bloqueios', coalesce((
      select jsonb_agg(distinct jsonb_build_object('artigo_nome', c.artigo_nome, 'motivo', 'Artigo em kg sem rendimento cadastrado'))
      from calc c where c.unidade_medida = 'kg' and coalesce(c.rendimento,0) <= 0 and c.deficit_m > 0), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $function$;

-- ACL: CREATE OR REPLACE preserva, mas re-afirma (invariante #9 — dos TRÊS; idempotente)
REVOKE EXECUTE ON FUNCTION public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
