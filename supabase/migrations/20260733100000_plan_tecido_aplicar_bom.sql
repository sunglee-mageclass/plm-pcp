-- 20260733100000_plan_tecido_aplicar_bom.sql — Plan. Tecido: aplicar BOM completo ao modelo.
-- Escritor de BOM compartilhado (tecido/forro + variantes + grade + tecidos_planejados; PRESERVA
-- entretela/aviamentos). Usado por: criar_card (novo modelo, já linka o slot) e aplicar_ao_modelo
-- (modelo existente; bloqueia só se LANÇADO — antes bloqueava por enviado_cad e só mandava grade).
begin;

-- escritor compartilhado: substitui o BOM de TECIDO/FORRO do modelo pelo do plano + grade (Tec 1) + tecidos_planejados
create or replace function public._plan_tecido_gravar_bom_core(_modelo uuid, _materiais jsonb)
returns void language plpgsql security definer set search_path to 'public' as $$
declare m jsonb; v jsonb; v_mt uuid; v_num int; v_tipo text;
begin
  -- limpa só tecido/forro (entretela e demais tipos ficam intactos) + a grade planejada
  delete from modelo_tecido_variantes where modelo_tecido_id in (
    select id from modelo_tecidos where modelo_id = _modelo and tipo in ('tecido','forro'));
  delete from modelo_tecidos where modelo_id = _modelo and tipo in ('tecido','forro');
  delete from modelo_grades where modelo_id = _modelo;

  for m in select * from jsonb_array_elements(coalesce(_materiais, '[]'::jsonb)) loop
    if nullif(m->>'artigo_id','') is null then continue; end if;
    v_num := coalesce((m->>'numero')::int, 1);
    v_tipo := coalesce(nullif(m->>'tipo',''), 'tecido');
    if v_tipo not in ('tecido','forro') then continue; end if;
    insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent)
    values (_modelo, (m->>'artigo_id')::uuid, v_num, v_tipo,
            coalesce((m->>'consumo')::numeric, 0), coalesce((m->>'loss_percent')::numeric, 0))
    returning id into v_mt;
    for v in select * from jsonb_array_elements(coalesce(m->'variantes', '[]'::jsonb)) loop
      if nullif(v->>'variante_tecido_id','') is null then continue; end if;
      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador)
      values (v_mt, (v->>'variante_tecido_id')::uuid, coalesce((v->>'ordem')::int, 1),
              coalesce((v->>'multiplicador')::numeric, 1));
      if v_tipo = 'tecido' and v_num = 1 then
        insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
        values (_modelo, coalesce((v->>'ordem')::int, 1),
                coalesce(v->'grades', '{}'::jsonb), coalesce((v->>'grade_total')::int, 0));
      end if;
    end loop;
  end loop;

  -- snapshot do Planejamento (tecidos_planejados) sempre consistente com o BOM real
  update modelos set tecidos_planejados = coalesce((
    select array_agg(distinct artigo_id) from modelo_tecidos
    where modelo_id = _modelo and tipo = 'tecido' and artigo_id is not null), '{}'::uuid[])
  where id = _modelo;
end $$;

-- CRIAR CARD: cria o modelo, grava o BOM (via escritor), e LINKA o slot do plano ao novo modelo
create or replace function public._plan_tecido_criar_card_core(_tenant uuid, _colecao_id uuid, _slot jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_mid uuid; v_mes uuid; v_ano uuid; v_sub text;
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
          'interno', 'em_planejamento')
  returning id into v_mid;

  perform public._plan_tecido_gravar_bom_core(v_mid, _slot->'materiais');

  -- vincula o slot do plano ao modelo criado (persistente; some o botão "Criar card")
  if nullif(_slot->>'slot_id','') is not null then
    update plan_tecido_slots set modelo_id = v_mid
    where id = (_slot->>'slot_id')::uuid and tenant_id = _tenant;
  end if;

  return v_mid;
end $$;

-- APLICAR AO MODELO: empurra o BOM do plano (tecido/forro + variantes + consumo + grade) ao modelo do slot.
-- Bloqueia só se LANÇADO (etapa avançada pode; lançado não).
create or replace function public._plan_tecido_aplicar_ao_modelo_core(_slot_id uuid, _materiais jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_modelo uuid; v_tenant uuid; v_lancado boolean;
begin
  select modelo_id, tenant_id into v_modelo, v_tenant from plan_tecido_slots where id = _slot_id;
  if v_tenant is null or v_tenant is distinct from public.get_user_tenant_id() then
    raise exception 'Sem permissão sobre este item.' using errcode = '42501';
  end if;
  if v_modelo is null then
    raise exception 'Este item não está ligado a um modelo. Crie o card antes de aplicar.' using errcode = 'P0001';
  end if;
  select lancado into v_lancado from modelos where id = v_modelo;
  if coalesce(v_lancado, false) then
    raise exception 'Modelo já lançado — não é possível alterar o BOM.' using errcode = '42501';
  end if;
  perform public._plan_tecido_gravar_bom_core(v_modelo, _materiais);
  return v_modelo;
end $$;

create or replace function public.plan_tecido_aplicar_ao_modelo(_slot_id uuid, _materiais jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('criacao') then raise exception 'Módulo criacao não habilitado' using errcode='42501'; end if;
  return public._plan_tecido_aplicar_ao_modelo_core(_slot_id, _materiais);
end $$;

revoke execute on function public._plan_tecido_gravar_bom_core(uuid,jsonb) from public, anon, authenticated;
revoke execute on function public._plan_tecido_aplicar_ao_modelo_core(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.plan_tecido_aplicar_ao_modelo(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
