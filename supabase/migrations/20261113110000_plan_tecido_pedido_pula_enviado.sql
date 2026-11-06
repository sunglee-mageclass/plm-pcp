-- F1 D fix 1 (dono 06/nov): o vinculo automatico do pedido PULA modelo ja enviado a Explosao/corte (modelos.enviado_cad) - custo congelado e
-- reserva de modelo em producao nao mudam por um pedido novo. Acrescenta `and not coalesce(m.enviado_cad,false)` ao filtro de modelos do bloco
-- da 20261113100000 em _plan_tecido_fazer_pedido_core (os 2 caminhos: colecao inteira e selecao). Resto igual (aditivo, lancado/reprovado, JWT).
-- ACCEPTED-MD5  public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[])  ANTES f5c4facad6302db824c7f8995a888dbf  DEPOIS be2e6be41a6e1cdf064d4b99d5e1531a
-- Volta: supabase/rollback/20261113110000_plan_tecido_pedido_pula_enviado_down.sql. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $guarda$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[])')));
  IF v IS NULL OR v NOT IN ('f5c4facad6302db824c7f8995a888dbf', 'be2e6be41a6e1cdf064d4b99d5e1531a') THEN
    RAISE EXCEPTION 'pedido_pula_enviado: _plan_tecido_fazer_pedido_core com texto inesperado (md5 %) - aplique antes a 20261113100000', coalesce(v,'ausente') USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._plan_tecido_fazer_pedido_core(_tenant uuid, _colecao_id uuid, _pedidos jsonb, _slot_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_forn jsonb; v_itens jsonb; v_valor numeric; v_oc jsonb; v_ocid uuid; v_num text;
  v_criadas int := 0; v_ocs uuid[] := '{}';
  v_a1 text; v_sig_emp text; v_sig_tec text; v_prefix text; v_seq int;
  v_modelo_alvo uuid;
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

    -- F1 D (dono 06/nov): a OC criada NASCE VINCULADA (modelo_tecido_oc_links) a TODOS os modelos que usam o
    -- tecido dela - pelo tecido, nao pelo hint do carrinho. Cobre os 2 caminhos: pedido por SELECAO (so os
    -- slots de _slot_ids) e pedido da COLECAO INTEIRA (_slot_ids NULL: o hint nao e gravado, entao os slots do
    -- tecido sao DERIVADOS aqui, pela mesma regra do bloco acima: artigo efetivo do material do slot).
    -- DECISOES:
    --  * ADITIVO, nao substitui: _plan_tecido_vincular_oc_nova_core so ACRESCENTA a OC nova ao que o modelo ja
    --    tem (necessidade que sobra, por variante). Vinculos de OCs anteriores ficam intactos (reescrever o
    --    conjunto todo reordenaria/soltaria OCs antigas conforme a ordem de ocs_disponiveis_variante).
    --  * Idempotente: UNIQUE (modelo, tipo, numero, ordem, item) + ON CONFLICT DO NOTHING.
    --  * Modelo LANCADO com o bloqueio da Config da Loja ligado e PULADO em silencio (o pedido nao aborta).
    --    Modelo REPROVADO tambem e pulado (sai da demanda/comprometido). enviado_cad (Explosao/corte)
    --    TAMBEM e pulado (F1 D fix 1, dono: modelo em producao tem custo e reserva definidos).
    --  * So modelos cujo BOM tem alguma cor que a OC nova cobre.
    --  * Alocacao usa ocs_disponiveis_variante (le get_user_tenant_id()): roda sob o JWT do usuario, como o
    --    wrapper plan_tecido_fazer_pedido; sem JWT a alocacao volta vazia e nada e vinculado (nada e apagado).
    for v_modelo_alvo in
      select m.id
      from modelos m
      where m.tenant_id = _tenant
        and m.id in (
          select sl.modelo_id
          from plan_tecido_slots sl
          join plan_tecido_linhas l on l.id = sl.linha_ref_id
          join plan_tecido_subcolecoes s on s.id = l.sub_id
          join plan_tecido p on p.id = s.plan_id and p.colecao_id = _colecao_id and p.tenant_id = _tenant
          where sl.modelo_id is not null
            and (_slot_ids is null or sl.id = any(_slot_ids))
            and exists (
              select 1 from plan_tecido_materiais mt
              left join plan_tecido_variantes vv on vv.material_id = mt.id
              left join variantes_tecido vt on vt.id = vv.variante_tecido_id
              where mt.slot_id = sl.id
                and coalesce(vt.artigo_id, mt.artigo_id) in
                    (select (it->>'artigo_id')::uuid from jsonb_array_elements(v_itens) it)
            )
        )
        and lower(coalesce(m.status_desenvolvimento, '')) <> 'reprovado'
        and lower(coalesce(m.status_planejamento, '')) <> 'reprovado'
        and not coalesce(m.enviado_cad, false)
        and not (coalesce(m.lancado, false)
                 and coalesce((select tc.plan_tecido_oc_bloqueia_lancado from tenant_config tc where tc.tenant_id = _tenant), true))
        and exists (
          select 1 from modelo_tecidos mt2
          join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt2.id
          join ocs_tecido_itens oi on oi.oc_tecido_id = v_ocid and oi.variante_tecido_id = mtv.variante_tecido_id
          where mt2.modelo_id = m.id and mt2.tipo in ('tecido','forro')
        )
      order by m.created_at, m.id
    loop
      perform public._plan_tecido_vincular_oc_nova_core(_tenant, v_modelo_alvo, v_ocid);
    end loop;
    v_criadas := v_criadas + 1;
    v_ocs := v_ocs || v_ocid;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'ocs', to_jsonb(v_ocs));
end $function$;

DO $pos$
BEGIN
  IF has_function_privilege('authenticated','public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[])','EXECUTE')
     OR has_function_privilege('anon','public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[])','EXECUTE') THEN
    RAISE EXCEPTION 'pedido_pula_enviado: ACL do _core mudou' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[])'))) IS DISTINCT FROM 'be2e6be41a6e1cdf064d4b99d5e1531a' THEN
    RAISE EXCEPTION 'pedido_pula_enviado: pos-condicao falhou no texto do _core' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
