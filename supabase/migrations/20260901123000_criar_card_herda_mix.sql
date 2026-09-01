-- Materializar vaga herda o mix reservado (decisão 9 do Agrupamento por Mix).
-- Quando uma VAGA vazia do Plan. Tecido (slot sem modelo) foi pré-atribuída a um mix
-- (plan_tecido_slots.mix_id), ao virar modelo real o mix precisa passar pro modelo
-- (modelos.mix_id — a fonte que o Plan. Produto consome).
--
-- Cirúrgico: adiciona `mix_id` ao INSERT em `modelos` do _plan_tecido_criar_card_core,
-- lido de `_slot->>'mix_id'`. Todo o resto da função é preservado byte-a-byte (diff-validado
-- contra pg_get_functiondef). SECURITY DEFINER mantido (função existente).

begin;

create or replace function public._plan_tecido_criar_card_core(_tenant uuid, _colecao_id uuid, _slot jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
                       origem, status_planejamento, mix_id)
  values (_tenant,
          coalesce(nullif(_slot->>'nome',''), nullif(_slot->>'ref',''), 'Novo modelo (Plan. Tecido)'),
          _colecao_id, v_sub,
          nullif(_slot->>'linha_id','')::uuid, nullif(_slot->>'categoria_id','')::uuid,
          v_mes, v_ano,
          nullif(_slot->>'preco_venda','')::numeric,
          coalesce(nullif(_slot->>'custo_terceirizados_previsto','')::numeric, 0),
          coalesce(_slot->'custo_simulado', '{}'::jsonb),
          'interno', 'em_planejamento',
          nullif(_slot->>'mix_id','')::uuid)   -- herda o mix reservado pela vaga (decisão 9)
  returning id into v_mid;

  perform public._plan_tecido_gravar_bom_core(v_mid, _slot->'materiais');

  -- [G4] migra referências do slot (se houver) para o modelo recém-criado.
  update modelos set fotos_referencia = fotos_referencia || (
    select coalesce(array_agg(t.x),'{}') from jsonb_array_elements_text(coalesce(_slot->'referencia_paths','[]'::jsonb)) t(x)
  ) where id = v_mid and jsonb_array_length(coalesce(_slot->'referencia_paths','[]'::jsonb)) > 0;

  -- vincula o slot do plano ao modelo criado (persistente; some o botão "Criar card")
  if nullif(_slot->>'slot_id','') is not null then
    update plan_tecido_slots set modelo_id = v_mid
    where id = (_slot->>'slot_id')::uuid and tenant_id = _tenant;
  end if;

  return v_mid;
end $function$;

commit;

select pg_notify('pgrst', 'reload schema');
