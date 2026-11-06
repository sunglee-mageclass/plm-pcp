-- Inverso de 20261113100000_plan_tecido_pedido_vincula_modelos.sql: devolve _plan_tecido_fazer_pedido_core ao texto anterior (sem a materializacao do
-- vinculo no pedido; md5 f1037609d35de5ad219b501627cd34b8) e remove o helper _plan_tecido_vincular_oc_nova_core (nada mais o chama). Vinculos ja
-- criados NAO sao desfeitos (sao dados validos; a Task C permite remover). Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';

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

DROP FUNCTION IF EXISTS public._plan_tecido_vincular_oc_nova_core(uuid,uuid,uuid);

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[])'))) IS DISTINCT FROM 'f1037609d35de5ad219b501627cd34b8' THEN
    RAISE EXCEPTION 'pedido_vincula down: texto do _core nao voltou ao anterior' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
