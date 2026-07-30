-- Endurecimentos vindos da revisão adversarial (todos LOW / defesa-em-profundidade):
--  M1) excluir_oc_tecido num ROLO dava a mensagem errada ("OC recebida") — agora RAISE claro pedindo
--      excluir_rolo. (Rolo nasce 'recebido', então já era bloqueado; só a mensagem confundia.)
--  M2) fazer_pedido: filtro de tenant na derivação da variante (falha cedo/clara em vez de depender do
--      RAISE transitivo de _salvar_oc_tecido_core).
--  M3) INVARIANTE documentado: a guarda de exclusão usa status='recebido' como proxy de "tem estoque"
--      porque o físico (_estoque_tecido_core) SÓ soma itens com status='recebido'. Se um dia existir
--      recebimento PARCIAL que grave quantidade_recebida sem virar o status, esta guarda precisará
--      passar a checar EXISTS(quantidade_recebida>0) — hoje seria falso-bloqueio (há OC 'encomendado'
--      com quantidade_recebida stale que NÃO vira físico).

CREATE OR REPLACE FUNCTION public._excluir_oc_tecido_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_status text;
  v_is_rolo boolean;
BEGIN
  SELECT status, coalesce(is_rolo, false) INTO v_status, v_is_rolo
  FROM public.ocs_tecido WHERE id = _oc_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- 0) rolo tem fluxo próprio (excluir_rolo, com _rolo_em_uso) — não excluir por aqui
  IF v_is_rolo THEN
    RAISE EXCEPTION 'Isto é um rolo — exclua pela tela de Rolos.' USING ERRCODE = 'P0001';
  END IF;

  -- 1) OC recebida = tem estoque no ledger (físico só conta itens 'recebido' — ver M3 no cabeçalho)
  IF v_status = 'recebido' THEN
    RAISE EXCEPTION 'Não é possível excluir: OC já recebida (tem estoque). Estorne o recebimento antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 2) baixa de estoque registrada (por item OU por rolo derivado desta OC)
  IF EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b JOIN public.ocs_tecido_itens it ON it.id = b.oc_tecido_item_id WHERE it.oc_tecido_id = _oc_id)
     OR EXISTS (SELECT 1 FROM public.estoque_tecido_baixas b WHERE b.rolo_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem baixa de estoque registrada.' USING ERRCODE = 'P0001';
  END IF;

  -- 3) vínculo de Desenvolvimento (modelo_tecido_oc_links)
  IF EXISTS (SELECT 1 FROM public.modelo_tecido_oc_links l JOIN public.ocs_tecido_itens it ON it.id = l.oc_tecido_item_id WHERE it.oc_tecido_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC está vinculada a modelo(s) no Desenvolvimento. Desvincule antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 4) rolo(s) derivado(s) desta OC
  IF EXISTS (SELECT 1 FROM public.ocs_tecido r JOIN public.ocs_tecido_itens it ON it.id = r.rolo_origem_item_id WHERE it.oc_tecido_id = _oc_id) THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem rolo(s) derivado(s). Exclua os rolos antes.' USING ERRCODE = 'P0001';
  END IF;

  -- 5) parcela paga no financeiro
  IF EXISTS (SELECT 1 FROM public.parcelas p WHERE p.oc_tecido_id = _oc_id AND p.status = 'pago') THEN
    RAISE EXCEPTION 'Não é possível excluir: a OC tem parcela paga no financeiro.' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM public.parcelas WHERE oc_tecido_id = _oc_id;
  DELETE FROM public.ocs_tecido WHERE id = _oc_id AND tenant_id = v_tenant;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._excluir_oc_tecido_core(uuid) FROM PUBLIC, anon, authenticated;

-- M2: filtro de tenant na derivação do artigo real da variante (falha cedo/clara).
CREATE OR REPLACE FUNCTION public._plan_tecido_fazer_pedido_core(_tenant uuid, _colecao_id uuid, _pedidos jsonb)
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
    v_prefix := coalesce(nullif(v_sig_emp,''),'OC') || coalesce(nullif(v_sig_tec,''),'TEC') || '-';
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
    v_criadas := v_criadas + 1;
    v_ocs := v_ocs || v_ocid;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'ocs', to_jsonb(v_ocs));
end $function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_fazer_pedido_core(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
