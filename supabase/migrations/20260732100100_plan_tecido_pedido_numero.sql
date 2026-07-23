-- 20260732100100_plan_tecido_pedido_numero.sql — Plan. Tecido (b3): nº de OC automático + 1 OC por entrada.
-- Agora cada entrada de _pedidos = UMA OC (o wizard já divide em ≤2 tecidos por página). Nº automático =
-- 3 iniciais do fornecedor + 3 iniciais do 1º tecido + sequencial de 5 dígitos por loja (anti-colisão).
begin;

create or replace function public._plan_tecido_fazer_pedido_core(_tenant uuid, _colecao_id uuid, _pedidos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_forn jsonb; v_itens jsonb; v_valor numeric; v_oc jsonb; v_ocid uuid; v_num text;
  v_criadas int := 0; v_ocs uuid[] := '{}';
  v_a1 text; v_sig_emp text; v_sig_tec text; v_prefix text; v_seq int;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  -- serializa a numeração por loja (evita nº repetido em pedidos concorrentes)
  perform pg_advisory_xact_lock(hashtext(_tenant::text || ':num_oc_plan'));

  for v_forn in select * from jsonb_array_elements(coalesce(_pedidos, '[]'::jsonb)) loop
    if nullif(v_forn->>'empresa_id','') is null then continue; end if;

    -- itens desta OC (o cliente já limitou a ≤2 tecidos); artigo_numero = 1/2 por artigo distinto
    with arts as (
      select distinct it->>'artigo_id' as aid
      from jsonb_array_elements(v_forn->'itens') it
      where nullif(it->>'artigo_id','') is not null and coalesce((it->>'quantidade_pedida')::numeric,0) > 0
    ), arts_num as (select aid, row_number() over (order by aid) as num from arts)
    select jsonb_agg(jsonb_build_object(
             'id', null, 'artigo_id', it->>'artigo_id', 'artigo_numero', an.num,
             'variante_tecido_id', it->>'variante_tecido_id',
             'quantidade_pedida', coalesce((it->>'quantidade_pedida')::numeric, 0),
             'quantidade_recebida', null,
             'rendimento', nullif(it->>'rendimento','')::numeric,
             'cancelado', false,
             'preco', nullif(it->>'preco','')::numeric))
      into v_itens
      from jsonb_array_elements(v_forn->'itens') it
      join arts_num an on an.aid = it->>'artigo_id'
      where coalesce((it->>'quantidade_pedida')::numeric, 0) > 0;

    if v_itens is null or jsonb_array_length(v_itens) = 0 then continue; end if;

    select coalesce(sum((it->>'quantidade_pedida')::numeric * coalesce((it->>'preco')::numeric,0)),0)
      into v_valor from jsonb_array_elements(v_itens) it;

    -- nº automático: SIG(fornecedor) + SIG(1º tecido) + '-' + sequencial por loja
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
      'data_pedido', current_date,
      'data_prevista_entrega', nullif(v_forn->>'data_prevista_entrega',''),
      'prazo_pagamento', v_forn->>'prazo_pagamento',
      'quantidade_prazos', coalesce((v_forn->>'quantidade_prazos')::int, 1),
      'valor_previsto_total', v_valor, 'valor_real_total', 0, 'status', 'encomendado');

    v_ocid := public._salvar_oc_tecido_core(null, v_oc, v_itens);
    insert into plan_tecido_ocs(colecao_id, oc_tecido_id) values (_colecao_id, v_ocid);
    v_criadas := v_criadas + 1;
    v_ocs := v_ocs || v_ocid;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'ocs', to_jsonb(v_ocs));
end $$;

notify pgrst, 'reload schema';
commit;
