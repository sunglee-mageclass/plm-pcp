-- Plan. Tecido — cobertura de OC aplicada exige USO REAL (decisão do dono ago/2026, opção B)
--
-- ANTES (bug/confusão): a prévia creditava como cobertura a PEDIDA CHEIA de qualquer OC "aplicada"
-- órfã (marcada no seletor, sem coleção dona via plan_tecido_ocs e SEM nenhum card vinculado). Como
-- owner_col ficava NULL, greatest(0, pedida - coalesce(owner_nec,0)) = pedida cheia → aplicar uma OC
-- avulsa zerava o "A comprar" sozinha, mesmo a OC estando só encomendada e sem uso planejado.
--
-- DEPOIS (opção B): cobertura de OC NÃO-própria só sai quando há USO PLANEJADO REAL desta coleção —
-- ≥1 card do Dev vinculado à OC (modelo_tecido_oc_links dos modelos da coleção) OU hint de slot
-- (plan_tecido_slot_oc). A "aplicada" pura (só marcada no seletor) vira acompanhamento: supply 0,
-- a OC segue aparecendo nos painéis de situação normalmente, mas não abate o "A comprar".
--   1. OC própria (Fazer pedido desta coleção → plan_tecido_ocs): INALTERADO (credita pedida cheia).
--   2. OC não-própria com card/slot vinculado (has_card): credita a MESMA sobra do dono de antes.
--   3. OC não-própria SEM card/slot (aplicada pura, órfã OU dona=outra coleção): supply 0.
--      A condição has_card é UNIFORME p/ TODA OC não-própria — inclusive as com dono = outra coleção
--      (a fórmula do montante — sobra = pedida − nec da dona — segue inalterada; só o GATE de entrada
--      passou a exigir uso real). Coerência: cobertura segue uso planejado, sem exceção por classe.
--   4. Rolo vinculado: INALTERADO (abate pelo SALDO — estoque físico; rolo_supply não usa has_card).
--   5. Cards usar_estoque: INALTERADO (já saem da necessidade em _plan_tecido_nec_variante_core).
--
-- União de fontes de membership = a MESMA já canonizada (auditoria jul/2026); não se cria uma 5ª
-- definição — só se distingue, dentro dela, qual fonte representa uso real (card/slot) vs marcação pura.

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
  supply as (  -- cobertura por (artigo, variante): própria = pedida cheia; NÃO-própria só credita com
               -- USO PLANEJADO REAL (has_card) — aí = sobra do dono. Sem card → 0 (só acompanhamento).
               -- Opção B, decisão do dono ago/2026.
    select op.artigo_id, op.variante_tecido_id,
           sum(case when ol.owned then op.pedida_m
                    when ol.has_card then greatest(0, op.pedida_m - coalesce(onec.nec_m, 0))
                    else 0 end) as supply_m
    from oc_pedida op
    join oc_link ol on ol.oc_tecido_id = op.oc_tecido_id
    left join owner_nec onec on onec.owner_col = ol.owner_col
      and onec.artigo_id = op.artigo_id and onec.variante_tecido_id = op.variante_tecido_id
    group by op.artigo_id, op.variante_tecido_id
  ),
  rolo_supply as (  -- SALDO do rolo VINCULADO (pedida − separacao_rolo já feita) credita cobertura como OC
    select it.artigo_id, it.variante_tecido_id,
           sum(greatest(0,
             (case when ar.unidade_medida='kg' then coalesce(it.quantidade_pedida,0)*coalesce(ar.rendimento,0)
                   else coalesce(it.quantidade_pedida,0) end)
             - coalesce((select sum(b.quantidade) from estoque_tecido_baixas b
                          where b.rolo_id = oc.id and b.origem = 'separacao_rolo'), 0)
           )) as rolo_m
    from oc_link ol
    join ocs_tecido oc on oc.id = ol.oc_tecido_id and oc.tenant_id = _tenant and coalesce(oc.is_rolo,false)
    join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false)=false and it.variante_tecido_id is not null
    join artigos ar on ar.id = it.artigo_id
    group by it.artigo_id, it.variante_tecido_id
  ),
  base as (
    select n.artigo_id, n.variante_tecido_id, n.nec_m,
           greatest(0, coalesce(e.previsto,0) - coalesce(rs.rolo_m,0)) as estoque_m,  -- rolo vinculado sai do estoque → vira cobertura
           round(greatest(0, n.nec_m - coalesce(sup.supply_m,0) - coalesce(rs.rolo_m,0))::numeric, 4) as deficit_m,  -- nec − OC (própria+sobra) − SALDO do rolo vinculado
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

-- ACL (invariante #9): revogar EXECUTE dos TRÊS (PUBLIC + anon + authenticated) — CREATE OR REPLACE
-- preserva o ACL existente, mas re-afirmamos por garantia. O acesso do cliente é só pelo wrapper
-- public.plan_tecido_previa_pedido (gate de módulo).
revoke execute on function public._plan_tecido_previa_pedido_core(uuid,uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
