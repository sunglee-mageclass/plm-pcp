-- Achados MEDIOS, release R11 (so banco; sem site): saldo por item de OC de tecido com a MESMA regra do core do estoque
-- (_estoque_tecido_core, CTE receb - invariante #4). Itens: est #3, est #10 e o entregue_m da Situacao por OC.
--   est #3  saldo_oc_item_m usava COALESCE(quantidade_recebida,0) e nao olhava status da OC nem item cancelado:
--           * item de OC RECEBIDA sem quantidade_recebida ficava com saldo 0 -> "Faltou estoque" FALSO no corte
--             (Ave Rara: 2 itens, MALHA BEGONIA);
--           * item CANCELADO e item de OC NAO RECEBIDA (encomendada com recebida preenchida) tinham saldo -> o corte
--             (Fase 1 por vinculo), o "- Metragem" e o criar rolo podiam baixar de onde o core nao conta estoque.
--   est #10 rolo_supply de _plan_tecido_previa_pedido_core usava pedida - separacao_rolo (a separacao mora no item de
--           ORIGEM): rolo separado ficava com saldo 0 e rolo avulso nao descontava corte/ajuste.
--   Situacao por OC: entregue_m tinha a mesma regra do est #3.
-- Regra nova (rulings do controlador 01/out, plan.md): o item so tem saldo se ocs_tecido.status = 'recebido' e o item nao
-- esta cancelado; recebido = quantidade_recebida, senao quantidade_pedida (0 se o item e reposicao de troca,
-- substitui_item_id); kg -> m pelo rendimento; saldo = recebido - baixas do ledger DO PROPRIO item. Fora disso -> 0.
-- Diferencas DELIBERADAS em relacao ao core (documentadas no relatorio da R11):
--   * item de ORIGEM de rolo: o core o exclui inteiro (est #4, corrigido na R15); aqui segue recebido - baixas
--     (inclui a baixa separacao_rolo), que e o saldo real - e o que a R15 leva para o core;
--   * o core clampa o fisico >= 0 POR VARIANTE; aqui o saldo e por item e nao e clampado (como antes);
--   * baixas de ordens de saida (os_baixa) sao por variante no core, nao tem item - nao entram aqui (como antes).
-- Efeito esperado (Passo 0 de producao 01/out 11:06): mudam cancelado=6, oc_nao_recebida=8, recebida_null=2; 0 itens
-- encomendados ganham saldo (75 com recebida NULL, 41 com card); 0 rolos ligados a colecao (est #10 latente).
-- Na copia 54422: cancelado=6, oc_nao_recebida=6, recebida_null=2. Nenhum dado gravado muda.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06) - md5 "antes" da copia 54422 = producao.
--   public.saldo_oc_item_m(uuid)
--     ANTES  0f6d4e7402db89db9b1e4eb803cde433  -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
--     DEPOIS 873789084182322f0b28b315d06b0dbc  (este arquivo; reaplicar = no-op)
--   public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])
--     ANTES  9ffdad2ee32301e159c58bec129ad49e  -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
--     DEPOIS dc5e43cf003506c68977b1d4a8b15834  (este arquivo; reaplicar = no-op)
--   public._plan_tecido_situacao_ocs_core(uuid,uuid)
--     ANTES  1ab8fe2e303b04ed7b9dfcba2e1fa657  -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
--     DEPOIS 29d4953a5ea039b9d995db12c511c8ae  (este arquivo; reaplicar = no-op)
--   Chamadores SEM mudanca (so guarda; leem saldo_oc_item_m):
--     public._baixar_estoque_tecido_corte_core(uuid)                      2a6f0ef24da6f9e8b9c68f63e3863577
--     public._remover_metragem_oc_core(uuid,numeric,text)                 635774e13418a33af6880f16728575c5
--     public._criar_rolo_core(text,uuid,jsonb,uuid,text,text)             ae0815c3f887ab909af6b5c83fdd6e27
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto da propria funcao; nada em tabela, nada em auth/storage).
-- Sem DDL de tabela, sem DROP, sem funcao nova. ACL: CREATE OR REPLACE mantem a de hoje (os 2 _core sem EXECUTE para
-- PUBLIC/anon/authenticated - inv. #9; saldo_oc_item_m segue so authenticated/service_role) - conferido no fim.
-- Volta: supabase/rollback/20261021100000_saldo_item_regra_do_core_down.sql (devolve os 3 textos de antes, com guarda
-- dos de depois). Nada gravado muda na ida nem na volta (baixas ja feitas com a regra nova ficam no ledger).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r11_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r11_md5_aceitos VALUES
  ('public.saldo_oc_item_m(uuid)',                              '0f6d4e7402db89db9b1e4eb803cde433', 'antes'),     -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
  ('public.saldo_oc_item_m(uuid)',                              '873789084182322f0b28b315d06b0dbc', 'depois'),
  ('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])',  '9ffdad2ee32301e159c58bec129ad49e', 'antes'),     -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
  ('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])',  'dc5e43cf003506c68977b1d4a8b15834', 'depois'),
  ('public._plan_tecido_situacao_ocs_core(uuid,uuid)',          '1ab8fe2e303b04ed7b9dfcba2e1fa657', 'antes'),     -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
  ('public._plan_tecido_situacao_ocs_core(uuid,uuid)',          '29d4953a5ea039b9d995db12c511c8ae', 'depois'),
  ('public._baixar_estoque_tecido_corte_core(uuid)',            '2a6f0ef24da6f9e8b9c68f63e3863577', 'chamador'),  -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
  ('public._remover_metragem_oc_core(uuid,numeric,text)',       '635774e13418a33af6880f16728575c5', 'chamador'),  -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)
  ('public._criar_rolo_core(text,uuid,jsonb,uuid,text,text)',   'ae0815c3f887ab909af6b5c83fdd6e27', 'chamador');  -- CONFIRMADO: Passo 0 dos MÉDIOS em produção (01/out 11:06)

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r11_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r11: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r11_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r11: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public.saldo_oc_item_m(_item_id uuid)
 RETURNS TABLE(saldo_m numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [medios R11 est #3] MESMA regra do CTE receb de _estoque_tecido_core (inv. #4): o item so tem saldo se a OC
  -- esta RECEBIDA e o item nao esta cancelado; recebido = quantidade_recebida, senao a pedida (0 se o item e
  -- reposicao de troca, substitui_item_id); kg -> m pelo rendimento. Saldo = recebido - baixas do ledger do item.
  -- OC nao recebida ou item cancelado -> 0 (antes: COALESCE(recebida,0) sem olhar status nem cancelado).
  WITH it AS (
    SELECT i.id, i.variante_tecido_id, i.quantidade_recebida, i.quantidade_pedida, i.substitui_item_id,
           (COALESCE(i.cancelado,false) OR oc.status IS DISTINCT FROM 'recebido') AS fora,
           a.unidade_medida, COALESCE(a.rendimento,0) AS rendimento,
           oc.tenant_id
    FROM public.ocs_tecido_itens i
    JOIN public.ocs_tecido oc ON oc.id = i.oc_tecido_id
    LEFT JOIN public.artigos a ON a.id = i.artigo_id
    WHERE i.id = _item_id
      AND (oc.tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
  ),
  rec AS (
    SELECT CASE WHEN unidade_medida='kg'
                THEN COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) * rendimento
                ELSE COALESCE(quantidade_recebida, CASE WHEN substitui_item_id IS NOT NULL THEN 0 ELSE quantidade_pedida END, 0) END AS m,
           fora
    FROM it
  ),
  bx AS (
    SELECT COALESCE(SUM(quantidade),0) AS m
    FROM public.estoque_tecido_baixas
    WHERE oc_tecido_item_id = _item_id
      AND EXISTS (SELECT 1 FROM it)
  )
  SELECT CASE WHEN (SELECT fora FROM rec) THEN 0::numeric
              ELSE (SELECT m FROM rec) - (SELECT m FROM bx) END
  WHERE EXISTS (SELECT 1 FROM it);
$function$;

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
         -- [medios R11] entregue = a MESMA regra do saldo por item / CTE receb do core: so OC RECEBIDA conta;
         -- recebida, senao a pedida (0 se e reposicao de troca). OC nao recebida -> 0 (item cancelado ja fica fora no join).
         (case when oc.status is distinct from 'recebido' then 0
               when ar.unidade_medida = 'kg'
                 then coalesce(it.quantidade_recebida, case when it.substitui_item_id is not null then 0 else it.quantidade_pedida end, 0) * coalesce(ar.rendimento,0)
               else coalesce(it.quantidade_recebida, case when it.substitui_item_id is not null then 0 else it.quantidade_pedida end, 0) end)::numeric as entregue_m,
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

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r11_md5_aceitos WHERE papel IN ('depois','chamador') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r11: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF has_function_privilege('anon', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r11: % ficou executavel por anon', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF r.assinatura LIKE 'public.\_%' AND has_function_privilege('authenticated', r.assinatura, 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r11: % ficou executavel por authenticated (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.assinatura) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r11: % ficou executavel por PUBLIC (inv. #9)', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
