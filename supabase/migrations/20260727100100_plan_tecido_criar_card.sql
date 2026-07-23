-- 20260727100100_plan_tecido_criar_card.sql — Fase B: criar card no Planejamento (Plan. Produto)
-- a partir de um slot do Plan. Tecido (modelo ainda não avançado). Cria o modelo + BOM (tecidos +
-- variantes + grade do Tecido 1) atomicamente. mês/ano herdados da coleção. Retorna o id do modelo.
begin;

create or replace function public._plan_tecido_criar_card_core(_tenant uuid, _colecao_id uuid, _slot jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_mid uuid; v_mes uuid; v_ano uuid; v_sub text; v_mt uuid; m jsonb; v jsonb; v_num int; v_tipo text;
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  select mes_id, ano_id into v_mes, v_ano from colecoes where id = _colecao_id;

  v_sub := nullif(_slot->>'subcolecao_nome','');
  if v_sub is null and nullif(_slot->>'subcolecao_id','') is not null then
    select nome into v_sub from colecao_subcolecoes where id = (_slot->>'subcolecao_id')::uuid and tenant_id = _tenant;
  end if;

  insert into modelos (tenant_id, nome, colecao_id, subcolecao, linha_id, categoria_principal_id,
                       mes_id, ano_id, preco_venda, custo_terceirizados_previsto, custo_simulado,
                       origem, status_planejamento)
  values (_tenant,
          coalesce(nullif(_slot->>'nome',''), nullif(_slot->>'ref',''), 'Novo modelo (Plan. Tecido)'),
          _colecao_id, v_sub,
          nullif(_slot->>'linha_id','')::uuid, nullif(_slot->>'categoria_id','')::uuid,
          v_mes, v_ano,
          nullif(_slot->>'preco_venda','')::numeric,
          coalesce(nullif(_slot->>'custo_terceirizados_previsto','')::numeric, 0),
          coalesce(_slot->'custo_simulado', '{}'::jsonb),
          'interno', 'em_planejamento')  -- origem CHECK aceita só interno/revenda
  returning id into v_mid;

  -- BOM: tecidos/forros + variantes; grade só do Tecido 1 (define a grade do modelo)
  for m in select * from jsonb_array_elements(coalesce(_slot->'materiais', '[]'::jsonb)) loop
    if nullif(m->>'artigo_id','') is null then continue; end if;
    v_num := coalesce((m->>'numero')::int, 1);
    v_tipo := coalesce(nullif(m->>'tipo',''), 'tecido');
    insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent)
    values (v_mid, (m->>'artigo_id')::uuid, v_num, v_tipo,
            coalesce((m->>'consumo')::numeric, 0), coalesce((m->>'loss_percent')::numeric, 0))
    returning id into v_mt;

    for v in select * from jsonb_array_elements(coalesce(m->'variantes', '[]'::jsonb)) loop
      if nullif(v->>'variante_tecido_id','') is null then continue; end if;
      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)
      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),
              coalesce((v->>'multiplicador')::numeric, 1));
      if v_tipo = 'tecido' and v_num = 1 then
        insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
        values (v_mid, coalesce((v->>'ordem')::int, 1),
                coalesce(v->'grades', '{}'::jsonb), coalesce((v->>'grade_total')::int, 0));
      end if;
    end loop;
  end loop;

  return v_mid;
end $$;

create or replace function public.plan_tecido_criar_card(_colecao_id uuid, _slot jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_criar_card_core(public.get_user_tenant_id(), _colecao_id, _slot);
end $$;

revoke execute on function public._plan_tecido_criar_card_core(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.plan_tecido_criar_card(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
