-- F3 (Plan. Tecido - transparencia no resumo), Task 1: a previa de pedido passa a EXPOR, so para exibicao:
--   (1) por linha de `cobertura`: `recebido_m` e `prev_receb_m` (do `_estoque_tecido_core`, ja em metros; 0 quando a variante
--       nao tem OC) - o site separa o "estoque" em "Em estoque (real)" x "A chegar (pedido)" no hover;
--   (2) chave de topo `outras_colecoes`: [{artigo_id, colecoes:[{colecao_id, colecao_nome, nec_m}]}] - OUTRAS colecoes do
--       MESMO tenant que usam os artigos da colecao atual (nec_m > 0, via `_plan_tecido_nec_variante_core`); artigo usado so
--       aqui nao aparece.
-- ADITIVO: so 3 mudancas sobre o texto da R15b (20261025400000): CTE `est` puxa +2 colunas; CTE `base` propaga +2 colunas;
-- CTE nova `outras_col` + 3 chaves no jsonb final. As linhas de estoque_m / deficit_m / qtd e todas as chaves/subchaves
-- existentes ficam byte a byte iguais - nenhuma conta de compra muda (anti-drift provado em
-- .superpowers/sdd/2026-11-09-f3-resumo-transparencia/task-1-report.md).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])
--     ANTES  b62ef170570b2444ad3f5727760cd411  (= DEPOIS da R15b fix1, 20261025400000)
--     DEPOIS ffcae79defe22e61e604b9d268fdf20b  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (nada em tabela, nada em auth/storage). Sem DDL de tabela, sem DROP, sem funcao
-- nova. ACL: CREATE OR REPLACE mantem a de hoje (o _core sem EXECUTE para PUBLIC/anon/authenticated - inv. #9) - conferido
-- no fim. O wrapper plan_tecido_previa_pedido nao muda (devolve o jsonb).
-- Inverso: supabase/rollback/20261115100000_f3_resumo_transparencia_down.sql (volta ao texto da R15b).
-- Banco ANTES do site. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'f3_resumo: _plan_tecido_previa_pedido_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])')));
  IF v_md5 NOT IN ('b62ef170570b2444ad3f5727760cd411', 'ffcae79defe22e61e604b9d268fdf20b') THEN
    RAISE EXCEPTION 'f3_resumo: _plan_tecido_previa_pedido_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public._plan_tecido_previa_pedido_core(_tenant uuid, _colecao_id uuid, _slot_ids uuid[] DEFAULT NULL::uuid[])
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
  est as ( select variante_tecido_id, previsto, recebido_m, prev_receb_m from public._estoque_tecido_core(_tenant) ),  -- [F3] + recebido_m/prev_receb_m (so exibicao; estoque_m/deficit_m seguem usando so `previsto`)
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
         -- [medios R15b fix1 M1] vinculo de card REPROVADO (nao enviado ao corte) nao liga a OC a colecao
         where not ((lower(coalesce(m.status_desenvolvimento,'')) = 'reprovado' or lower(coalesce(m.status_planejamento,'')) = 'reprovado')
              and not exists (select 1 from cad cc where cc.modelo_id = m.id and cc.enviado_corte))
        union all
        select so.oc_tecido_id, true as has_card    -- hint de slot (uso planejado no card)
          from plan_tecido_slot_oc so
          left join plan_tecido_slots hs on hs.id = so.slot_id
          left join modelos hm on hm.id = hs.modelo_id
         where so.colecao_id = _colecao_id and so.tenant_id = _tenant
           -- [medios R15b fix1 M1] hint da vaga de card REPROVADO (nao enviado ao corte) nao liga a OC; vaga sem card liga
           and not ((lower(coalesce(hm.status_desenvolvimento,'')) = 'reprovado' or lower(coalesce(hm.status_planejamento,'')) = 'reprovado')
                and not exists (select 1 from cad cc where cc.modelo_id = hm.id and cc.enviado_corte))
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
  rolo_supply as (  -- SALDO do rolo VINCULADO credita cobertura como OC. [medios R11 est #10] saldo = o do ITEM do rolo pela
                    -- MESMA regra de saldo_oc_item_m / CTE receb do core: OC recebida e item nao cancelado; recebida, senao a
                    -- pedida (0 se troca); menos as baixas do PROPRIO item (corte/ajuste). Antes era pedida - separacao_rolo
                    -- (que mora no item de ORIGEM): rolo separado ficava 0 e rolo avulso nao descontava corte/ajuste.
                    -- rolo_m = TOTAL (abate do estoque exibido, inalterado); rolo_own_m = so rolos PROPRIOS
                    -- (plan_tecido_ocs desta colecao) - entram no pool proprio do [FIX selecao].
    select it.artigo_id, it.variante_tecido_id,
           sum(greatest(0, rsi.saldo_m)) as rolo_m,
           coalesce(sum(greatest(0, rsi.saldo_m)) filter (where ol.owned), 0) as rolo_own_m
    from oc_link ol
    join ocs_tecido oc on oc.id = ol.oc_tecido_id and oc.tenant_id = _tenant and coalesce(oc.is_rolo,false)
    join ocs_tecido_itens it on it.oc_tecido_id = oc.id and coalesce(it.cancelado,false)=false and it.variante_tecido_id is not null
    join artigos ar on ar.id = it.artigo_id
    cross join lateral (
      select case when oc.status is distinct from 'recebido' then 0::numeric
                  else (case when ar.unidade_medida='kg'
                               then coalesce(it.quantidade_recebida, case when it.substitui_item_id is not null then 0 else it.quantidade_pedida end, 0)*coalesce(ar.rendimento,0)
                             else coalesce(it.quantidade_recebida, case when it.substitui_item_id is not null then 0 else it.quantidade_pedida end, 0) end)
                       - coalesce((select sum(b.quantidade) from estoque_tecido_baixas b where b.oc_tecido_item_id = it.id), 0)
             end as saldo_m
    ) rsi
    -- [medios R11 fix M1] rolo SEPARADO de uma OC que ja credita esta colecao no supply (propria, ou nao-propria com
    -- has_card) NAO credita de novo: o supply conta a OC de origem pela PEDIDA, que a separacao nao baixa - os metros
    -- do rolo ja estao la (senao contaria 2x e o "a comprar" sub-pediria).
    where not exists (
      select 1
        from ocs_tecido_itens oi
        join ocs_tecido ooc on ooc.id = oi.oc_tecido_id and ooc.tenant_id = _tenant and not coalesce(ooc.is_rolo,false)
        join oc_link ol2 on ol2.oc_tecido_id = ooc.id and (ol2.owned or ol2.has_card)
       where oi.id = oc.rolo_origem_item_id
         and coalesce(oi.cancelado,false) = false and oi.variante_tecido_id is not null)
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
           coalesce(vt.preco, a.preco, 0) as preco,
           coalesce(e.recebido_m,0) as recebido_m, coalesce(e.prev_receb_m,0) as prev_receb_m  -- [F3] so exibicao (hover do estoque)
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
  outras_col as (  -- [F3] OUTRAS coleções (mesmo tenant, != atual) que usam os artigos da coleção atual: nec_m por (artigo, coleção).
                   -- Só exibição ("i" ao lado do tecido); não entra em nenhuma conta. Reusa _plan_tecido_nec_variante_core (todos os slots).
    select x.artigo_id,
           jsonb_agg(jsonb_build_object('colecao_id', x.colecao_id, 'colecao_nome', x.colecao_nome, 'nec_m', x.nec_m)
                     order by x.colecao_nome, x.colecao_id) as colecoes
    from (
      select nn.artigo_id, o.colecao_id, o.colecao_nome, sum(nn.nec_m) as nec_m
      from (
        select distinct pp.colecao_id, co.nome as colecao_nome
        from plan_tecido pp
        join colecoes co on co.id = pp.colecao_id and co.tenant_id = _tenant
        where pp.tenant_id = _tenant and pp.colecao_id <> _colecao_id
      ) o
      cross join lateral public._plan_tecido_nec_variante_core(_tenant, o.colecao_id) nn
      where nn.artigo_id in (select nec.artigo_id from necessidade nec)
      group by nn.artigo_id, o.colecao_id, o.colecao_nome
      having sum(nn.nec_m) > 0
    ) x
    group by x.artigo_id
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
        'nec_m', c.nec_m, 'estoque_m', c.estoque_m, 'deficit_m', c.deficit_m,
        'recebido_m', c.recebido_m, 'prev_receb_m', c.prev_receb_m)  -- [F3] aditivo
        order by c.artigo_nome, c.label)
      from calc c), '[]'::jsonb),
    'bloqueios', coalesce((
      select jsonb_agg(distinct jsonb_build_object('artigo_nome', c.artigo_nome, 'motivo', 'Artigo em kg sem rendimento cadastrado'))
      from calc c where c.unidade_medida = 'kg' and coalesce(c.rendimento,0) <= 0 and c.deficit_m > 0), '[]'::jsonb),
    'outras_colecoes', coalesce((  -- [F3] aditivo: [{artigo_id, colecoes:[{colecao_id, colecao_nome, nec_m}]}]
      select jsonb_agg(jsonb_build_object('artigo_id', oc.artigo_id, 'colecoes', oc.colecoes) order by oc.artigo_id)
      from outras_col oc), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $function$;


DO $pos$
DECLARE
  v_sig constant text := 'public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])';
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure(v_sig)));
  IF v_md5 IS DISTINCT FROM 'ffcae79defe22e61e604b9d268fdf20b' THEN
    RAISE EXCEPTION 'f3_resumo: pos-condicao falhou - % nao ficou com o texto esperado (md5 %)', v_sig, v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'f3_resumo: % ficou executavel por anon', v_sig USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'f3_resumo: % ficou executavel por authenticated (inv. #9)', v_sig USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'f3_resumo: OK - md5 DEPOIS = %', v_md5;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
