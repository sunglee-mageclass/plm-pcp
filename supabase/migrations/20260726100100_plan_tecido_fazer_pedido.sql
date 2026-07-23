-- 20260726100100_plan_tecido_fazer_pedido.sql — Fase B parte 2:
-- gerar OC(s) do plano (1 OC por fornecedor, split em ≤2 tecidos), status do pedido, desfazer.
begin;

-- CONFIRMAR: gera as OCs a partir dos pedidos confirmados na prévia (_pedidos por fornecedor).
create or replace function public._plan_tecido_fazer_pedido_core(_tenant uuid, _colecao_id uuid, _pedidos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_forn jsonb; v_arts text[]; v_a1 text; v_a2 text; i int;
  v_itens jsonb; v_valor numeric; v_oc jsonb; v_ocid uuid; v_num text;
  v_seq int := 0; v_criadas int := 0; v_ocs uuid[] := '{}';
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext(_colecao_id::text || ':fazer_pedido'));

  for v_forn in select * from jsonb_array_elements(coalesce(_pedidos, '[]'::jsonb)) loop
    if nullif(v_forn->>'empresa_id','') is null then continue; end if;  -- sem fornecedor não gera
    select array_agg(distinct it->>'artigo_id') into v_arts
      from jsonb_array_elements(v_forn->'itens') it where nullif(it->>'artigo_id','') is not null;
    if v_arts is null then continue; end if;

    i := 1;
    while i <= array_length(v_arts,1) loop
      v_a1 := v_arts[i];
      v_a2 := case when i+1 <= array_length(v_arts,1) then v_arts[i+1] else null end;

      select jsonb_agg(jsonb_build_object(
               'id', null,
               'artigo_id', it->>'artigo_id',
               'artigo_numero', case when it->>'artigo_id' = v_a1 then 1 else 2 end,
               'variante_tecido_id', it->>'variante_tecido_id',
               'quantidade_pedida', coalesce((it->>'quantidade_pedida')::numeric, 0),
               'quantidade_recebida', null,
               'rendimento', nullif(it->>'rendimento','')::numeric,
               'cancelado', false,
               'preco', nullif(it->>'preco','')::numeric))
        into v_itens
        from jsonb_array_elements(v_forn->'itens') it
        where it->>'artigo_id' in (v_a1, coalesce(v_a2, v_a1))
          and coalesce((it->>'quantidade_pedida')::numeric,0) > 0;

      if v_itens is null or jsonb_array_length(v_itens) = 0 then i := i + 2; continue; end if;

      select coalesce(sum((it->>'quantidade_pedida')::numeric * coalesce((it->>'preco')::numeric,0)),0)
        into v_valor from jsonb_array_elements(v_itens) it;

      v_num := 'PLAN-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || lpad(v_seq::text, 2, '0');
      v_seq := v_seq + 1;

      v_oc := jsonb_build_object(
        'numero_pedido', v_num,
        'empresa_id', v_forn->>'empresa_id',
        'representante_id', nullif(v_forn->>'representante_id',''),
        'data_pedido', current_date,
        'data_prevista_entrega', nullif(v_forn->>'data_prevista_entrega',''),
        'prazo_pagamento', v_forn->>'prazo_pagamento',
        'quantidade_prazos', coalesce((v_forn->>'quantidade_prazos')::int, 1),
        'valor_previsto_total', v_valor,
        'valor_real_total', 0,
        'status', 'encomendado');

      v_ocid := public._salvar_oc_tecido_core(null, v_oc, v_itens);
      insert into plan_tecido_ocs(colecao_id, oc_tecido_id) values (_colecao_id, v_ocid);
      v_criadas := v_criadas + 1;
      v_ocs := v_ocs || v_ocid;
      i := i + 2;
    end loop;
  end loop;

  return jsonb_build_object('criadas', v_criadas, 'ocs', to_jsonb(v_ocs));
end $$;

create or replace function public.plan_tecido_fazer_pedido(_colecao_id uuid, _pedidos jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  if not public.tenant_module_enabled('entrada_saida') then raise exception 'Módulo entrada_saida não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_fazer_pedido_core(public.get_user_tenant_id(), _colecao_id, _pedidos);
end $$;

-- STATUS do pedido por coleção (p/ badge da lista)
create or replace function public._plan_tecido_status_pedidos_core(_tenant uuid)
returns table(colecao_id uuid, status text) language sql stable security definer set search_path to 'public' as $$
  select po.colecao_id,
         case when bool_and(oc.status = 'recebido') then 'entregue' else 'encomendado' end
  from plan_tecido_ocs po
  join ocs_tecido oc on oc.id = po.oc_tecido_id
  where po.tenant_id = _tenant and not coalesce(oc.is_rolo, false)
  group by po.colecao_id;
$$;

create or replace function public.plan_tecido_status_pedidos()
returns table(colecao_id uuid, status text) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then return; end if;
  return query select * from public._plan_tecido_status_pedidos_core(public.get_user_tenant_id());
end $$;

-- DESFAZER: apaga só OCs 'encomendado' da coleção (bloqueia se alguma já recebida)
create or replace function public._plan_tecido_desfazer_pedido_core(_tenant uuid, _colecao_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  if exists (select 1 from plan_tecido_ocs po join ocs_tecido oc on oc.id = po.oc_tecido_id
             where po.colecao_id = _colecao_id and oc.status = 'recebido') then
    raise exception 'Há OC já recebida desta coleção — não é possível desfazer o pedido.' using errcode = 'P0001';
  end if;
  delete from ocs_tecido where id in (
    select po.oc_tecido_id from plan_tecido_ocs po
    join ocs_tecido oc on oc.id = po.oc_tecido_id
    where po.colecao_id = _colecao_id and oc.status = 'encomendado'
  );
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.plan_tecido_desfazer_pedido(_colecao_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_desfazer_pedido_core(public.get_user_tenant_id(), _colecao_id);
end $$;

revoke execute on function public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb) from public, anon, authenticated;
revoke execute on function public._plan_tecido_status_pedidos_core(uuid) from public, anon, authenticated;
revoke execute on function public._plan_tecido_desfazer_pedido_core(uuid,uuid) from public, anon, authenticated;
grant execute on function public.plan_tecido_fazer_pedido(uuid,jsonb) to authenticated;
grant execute on function public.plan_tecido_status_pedidos() to authenticated;
grant execute on function public.plan_tecido_desfazer_pedido(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
