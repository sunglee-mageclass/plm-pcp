-- G5 (Pacote G-feat, Ondas 3+4): pedido POR SELEÇÃO de cards + carrinho (slot↔OC) no Plan. Tecido.
-- (a) `_plan_tecido_nec_variante_core` ganha `_slot_ids uuid[] DEFAULT NULL` (assinatura muda →
--     DROP + CREATE); NULL = coleção inteira, byte-a-byte o comportamento de hoje.
-- (b) `_plan_tecido_previa_pedido_core`/`plan_tecido_previa_pedido` repassam `_slot_ids` à CTE
--     `necessidade`; `owner_nec` CONTINUA com a necessidade TOTAL da coleção dona (sobra = pedida −
--     nec total — o filtro de seleção NÃO se aplica ao dono de OC de fora; chamada de 2 args
--     resolve pelo DEFAULT NULL).
-- (c) `plan_tecido_fazer_pedido`/`_core` ganham `_slot_ids uuid[] DEFAULT NULL`: com seleção, após
--     criar cada OC grava `plan_tecido_slot_oc` (carrinho acende na hora) — vínculo por ARTIGO:
--     cada slot selecionado linka à(s) OC(s) que cobrem o artigo efetivo dos seus materiais.
--     Sem `_slot_ids` (NULL) = comportamento de hoje (nenhum vínculo por slot).
-- ⚠️ DROP+recreate ZERA a ACL → re-REVOKE dos TRÊS em todos os `_core` + re-GRANT dos wrappers
--     (invariante #9). Bônus: o wrapper `plan_tecido_fazer_pedido` estava com o "anon=true LATENTE"
--     (ficou fora do hardening 20260820100000); recriado, sai hardened como os irmãos.
-- Corpos partem dos functiondefs VIVOS (capturados 2026-08-29, diff-validado em teste revertido).
-- Idempotente: DROP IF EXISTS das assinaturas antigas + CREATE OR REPLACE das novas.
BEGIN;

-- DROPs primeiro (assinaturas ANTIGAS; a nova com DEFAULT coexistindo com a antiga = ambiguidade)
DROP FUNCTION IF EXISTS public.plan_tecido_previa_pedido(uuid);
DROP FUNCTION IF EXISTS public._plan_tecido_previa_pedido_core(uuid,uuid);
DROP FUNCTION IF EXISTS public._plan_tecido_nec_variante_core(uuid,uuid);
DROP FUNCTION IF EXISTS public.plan_tecido_fazer_pedido(uuid,jsonb);
DROP FUNCTION IF EXISTS public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb);

-- (a) nec_variante — DEF VIVO + _slot_ids no WHERE
CREATE OR REPLACE FUNCTION public._plan_tecido_nec_variante_core(_tenant uuid, _colecao_id uuid, _slot_ids uuid[] DEFAULT NULL)
 RETURNS TABLE(artigo_id uuid, variante_tecido_id uuid, nec_m numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(vt.artigo_id, mt.artigo_id) as artigo_id, vv.variante_tecido_id,
         sum(coalesce(mt.consumo,0) * coalesce(vv.grade_total,0) * coalesce(vv.multiplicador,1))::numeric as nec_m
  from plan_tecido p
  join plan_tecido_subcolecoes s on s.plan_id = p.id
  join plan_tecido_linhas l on l.sub_id = s.id
  join plan_tecido_slots sl on sl.linha_ref_id = l.id  -- flag usar_estoque APOSENTADO (17/ago): TODO card entra na necessidade; cobertura por vínculo abate
  join plan_tecido_materiais mt on mt.slot_id = sl.id
  join plan_tecido_variantes vv on vv.material_id = mt.id
  left join variantes_tecido vt on vt.id = vv.variante_tecido_id  -- artigo REAL da variante (raiz do fix de 20260802140000)
  where p.colecao_id = _colecao_id and p.tenant_id = _tenant
    and (_slot_ids is null or sl.id = any(_slot_ids))  -- [G5] filtro por seleção de cards; NULL = coleção inteira (comportamento de hoje)
    and vv.variante_tecido_id is not null
    and coalesce(vt.artigo_id, mt.artigo_id) is not null
  group by coalesce(vt.artigo_id, mt.artigo_id), vv.variante_tecido_id;
$function$;

-- (b) prévia core — DEF VIVO + repasse do _slot_ids na CTE necessidade
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

-- (b) prévia wrapper — gate criacao (inalterado) + repasse
CREATE OR REPLACE FUNCTION public.plan_tecido_previa_pedido(_colecao_id uuid, _slot_ids uuid[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_previa_pedido_core(public.get_user_tenant_id(), _colecao_id, _slot_ids);
end $function$;

-- (c) fazer_pedido core — DEF VIVO + gravação do carrinho (plan_tecido_slot_oc)
CREATE OR REPLACE FUNCTION public._plan_tecido_fazer_pedido_core(_tenant uuid, _colecao_id uuid, _pedidos jsonb, _slot_ids uuid[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_forn jsonb; v_itens jsonb; v_valor numeric; v_oc jsonb; v_ocid uuid; v_num text;
  v_criadas int := 0; v_ocs uuid[] := '{}';
  v_a1 text; v_sig_emp text; v_sig_tec text; v_prefix text; v_seq int;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(_tenant::text || ':num_oc_plan'));

  for v_forn in select * from jsonb_array_elements(coalesce(_pedidos, '[]'::jsonb)) loop
    if nullif(v_forn->>'empresa_id','') is null then continue; end if;

    -- artigo_id DERIVADO do artigo REAL da variante (do MESMO tenant) — não confia no payload;
    -- rendimento idem. artigo_numero = 1/2 por artigo REAL distinto. (cliente já limitou a ≤2 tecidos)
    with items_raw as (
      select it,
             coalesce(
               (select v.artigo_id from variantes_tecido v where v.id = nullif(it->>'variante_tecido_id','')::uuid and v.tenant_id = _tenant),
               nullif(it->>'artigo_id','')::uuid
             ) as aid
      from jsonb_array_elements(v_forn->'itens') it
      where coalesce((it->>'quantidade_pedida')::numeric,0) > 0
    ),
    arts_num as (
      select aid, row_number() over (order by aid) as num
      from (select distinct aid from items_raw where aid is not null) s
    )
    select jsonb_agg(jsonb_build_object(
             'id', null, 'artigo_id', ir.aid, 'artigo_numero', an.num,
             'variante_tecido_id', ir.it->>'variante_tecido_id',
             'quantidade_pedida', coalesce((ir.it->>'quantidade_pedida')::numeric, 0),
             'quantidade_recebida', null,
             'rendimento', coalesce((select a.rendimento from artigos a where a.id = ir.aid), nullif(ir.it->>'rendimento','')::numeric),
             'cancelado', false,
             'preco', nullif(ir.it->>'preco','')::numeric))
      into v_itens
      from items_raw ir
      join arts_num an on an.aid = ir.aid
      where ir.aid is not null;

    if v_itens is null or jsonb_array_length(v_itens) = 0 then continue; end if;

    select coalesce(sum((it->>'quantidade_pedida')::numeric * coalesce((it->>'preco')::numeric,0)),0)
      into v_valor from jsonb_array_elements(v_itens) it;

    select it->>'artigo_id' into v_a1
      from jsonb_array_elements(v_itens) it order by (it->>'artigo_numero')::int limit 1;
    select upper(left(regexp_replace(coalesce(nome_fantasia,''), '[^A-Za-z0-9]', '', 'g'), 3))
      into v_sig_emp from empresas where id = (v_forn->>'empresa_id')::uuid;
    select upper(left(regexp_replace(coalesce(nome,''), '[^A-Za-z0-9]', '', 'g'), 3))
      into v_sig_tec from artigos where id = v_a1::uuid;
    v_prefix := 'T-' || coalesce(nullif(v_sig_emp,''),'FOR') || coalesce(nullif(v_sig_tec,''),'MAT') || '-';
    select coalesce(max(nullif(regexp_replace(numero_pedido, '^.*\D', '', ''), '')::int), 0) + 1
      into v_seq from ocs_tecido
      where tenant_id = _tenant and numero_pedido like v_prefix || '%' and numero_pedido ~ (v_prefix || '\d+$');
    v_num := v_prefix || lpad(v_seq::text, 5, '0');
    while exists (select 1 from ocs_tecido where tenant_id = _tenant and numero_pedido = v_num) loop
      v_seq := v_seq + 1; v_num := v_prefix || lpad(v_seq::text, 5, '0');
    end loop;

    v_oc := jsonb_build_object(
      'numero_pedido', v_num,
      'empresa_id', v_forn->>'empresa_id',
      'representante_id', nullif(v_forn->>'representante_id',''),
      'data_pedido', coalesce(nullif(v_forn->>'data_pedido','')::date, current_date),
      'data_prevista_entrega', nullif(v_forn->>'data_prevista_entrega',''),
      'prazo_pagamento', v_forn->>'prazo_pagamento',
      'quantidade_prazos', coalesce((v_forn->>'quantidade_prazos')::int, 1),
      'observacoes_entrega', nullif(v_forn->>'observacoes_entrega',''),
      'responsavel_nome', nullif(v_forn->>'responsavel_nome',''),
      'responsavel_id', nullif(v_forn->>'responsavel_id',''),
      'parcelas_recebimento', coalesce(v_forn->'parcelas_recebimento', '[]'::jsonb),
      'valor_previsto_total', v_valor, 'valor_real_total', 0, 'status', 'encomendado');

    v_ocid := public._salvar_oc_tecido_core(null, v_oc, v_itens);
    insert into plan_tecido_ocs(colecao_id, oc_tecido_id) values (_colecao_id, v_ocid);

    -- [G5] carrinho: com pedido POR SELEÇÃO, vincula cada slot selecionado a esta OC quando ela
    -- cobre o ARTIGO efetivo do material do slot (artigo REAL da variante, fallback no artigo do
    -- material — mesma regra da necessidade). Join pela árvore do plano garante tenant/coleção.
    -- Sem _slot_ids (NULL) = comportamento de hoje: nenhum vínculo por slot.
    -- (INSERT dispara trg_colab_bump → plan_rev++ → o carrinho acende via realtime.)
    if _slot_ids is not null then
      insert into plan_tecido_slot_oc (tenant_id, colecao_id, slot_id, oc_tecido_id)
      select _tenant, _colecao_id, sl.id, v_ocid
      from plan_tecido_slots sl
      join plan_tecido_linhas l on l.id = sl.linha_ref_id
      join plan_tecido_subcolecoes s on s.id = l.sub_id
      join plan_tecido p on p.id = s.plan_id and p.colecao_id = _colecao_id and p.tenant_id = _tenant
      where sl.id = any(_slot_ids)
        and exists (
          select 1 from plan_tecido_materiais mt
          left join plan_tecido_variantes vv on vv.material_id = mt.id
          left join variantes_tecido vt on vt.id = vv.variante_tecido_id
          where mt.slot_id = sl.id
            and coalesce(vt.artigo_id, mt.artigo_id) in
                (select (it->>'artigo_id')::uuid from jsonb_array_elements(v_itens) it)
        )
      on conflict (slot_id, oc_tecido_id) do nothing;
    end if;
    v_criadas := v_criadas + 1;
    v_ocs := v_ocs || v_ocid;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'ocs', to_jsonb(v_ocs));
end $function$;

-- (c) fazer_pedido wrapper — gates criacao+entrada_saida (inalterados) + repasse
CREATE OR REPLACE FUNCTION public.plan_tecido_fazer_pedido(_colecao_id uuid, _pedidos jsonb, _slot_ids uuid[] DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  if not public.tenant_module_enabled('entrada_saida') then raise exception 'Módulo entrada_saida não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_fazer_pedido_core(public.get_user_tenant_id(), _colecao_id, _pedidos, _slot_ids);
end $function$;


-- Re-ACL (DROP zerou tudo; invariante #9 — revogar dos TRÊS nos _core, wrapper só authenticated)
REVOKE EXECUTE ON FUNCTION public._plan_tecido_nec_variante_core(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_previa_pedido(uuid,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_previa_pedido(uuid,uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
