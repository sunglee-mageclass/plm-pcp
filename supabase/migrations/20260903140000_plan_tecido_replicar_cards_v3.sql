-- Correção v3 do "Replicar card(s)" do Plan. Tecido (sobre v2 20260903130000):
-- O INSERT do modelo replicado esquecia colunas STORED que o card do Plan. Produto LÊ:
--  (1) `colecao` (TEXTO) — o card renderiza `modelo.colecao` (coluna texto legada), NÃO faz join
--      por colecao_id → a réplica mostrava "—" na coleção. FIX: gravar o NOME da coleção destino.
--  (2) `custo_peca_previsto` (+ correlatos custo_tecido/forro/entretela/aviamento_total) — a RPC de
--      custo (`custo_unitario_modelos`), p/ modelo SEM CAD (caso da réplica — não copiamos CAD),
--      usa o FALLBACK `custo_peca_previsto`; como estava NULL, custo=0 → preço=0 → card "—". FIX:
--      copiar essas colunas de custo do original.
-- Só REPLACE do _core (assinatura/wrapper/ACL inalterados). Não-destrutiva.

BEGIN;

CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(
  _tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _modelo_ids uuid[], _rev_base int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_sub_nome text; v_col_nome text; v_mes uuid; v_ano uuid;
  v_plan uuid; v_sub_pt uuid; v_rev int;
  v_root uuid; v_versao int; v_novo uuid; v_slot uuid; v_slot_idx int; v_ln uuid;
  o record; mt_old record; v_novo_mt uuid; v_out jsonb := '[]'::jsonb;
begin
  -- (0) Guardas de tenant/destino.
  if _tenant is null or _tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inválida.' using errcode = '42501';
  end if;
  if (select tenant_id from colecoes where id = _destino_colecao_id) is distinct from _tenant then
    raise exception 'Coleção de destino de outra loja.' using errcode = '42501';
  end if;
  if _destino_subcolecao_id is not null then
    select nome into v_sub_nome from colecao_subcolecoes
      where id = _destino_subcolecao_id and colecao_id = _destino_colecao_id and tenant_id = _tenant;
    if v_sub_nome is null then
      raise exception 'Subcoleção de destino inválida.' using errcode = '42501';
    end if;
  end if;
  -- nome da coleção destino p/ a coluna TEXTO `modelos.colecao` (o card lê isso) + mes/ano.
  select nome, mes_id, ano_id into v_col_nome, v_mes, v_ano from colecoes where id = _destino_colecao_id;

  if exists (select 1 from modelos where id = any(_modelo_ids) and tenant_id = _tenant and origem = 'revenda') then
    raise exception 'Replicar cards de revenda ainda não é suportado.' using errcode = 'P0001';
  end if;

  -- (1) Trava otimista do DESTINO (só quando o front conhece o rev — destino == coleção aberta).
  if _rev_base is not null then
    select plan_rev into v_rev from colecoes where id = _destino_colecao_id for update;
    if coalesce(v_rev, 0) is distinct from _rev_base then
      raise exception 'conflito_versao: o registro foi salvo por outra pessoa' using errcode = 'P0409';
    end if;
  end if;

  -- (2) Garante plan_tecido + subcoleção-do-plano no DESTINO.
  insert into plan_tecido (colecao_id) values (_destino_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;

  if _destino_subcolecao_id is not null then
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
    values (v_plan, _destino_subcolecao_id,
            coalesce((select ordem from colecao_subcolecoes where id = _destino_subcolecao_id), 0))
    on conflict (plan_id, subcolecao_id) do update set ordem = excluded.ordem
    returning id into v_sub_pt;
  else
    select id into v_sub_pt from plan_tecido_subcolecoes
      where plan_id = v_plan and subcolecao_id is null limit 1;
    if v_sub_pt is null then
      insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, null, 0) returning id into v_sub_pt;
    end if;
  end if;

  -- (3) Por modelo origem.
  for o in select * from modelos where id = any(_modelo_ids) and tenant_id = _tenant for update loop
    v_root := coalesce(o.modelo_base_id, o.id);
    select coalesce(max(versao), 1) + 1 into v_versao
      from modelos where (id = v_root or modelo_base_id = v_root) and tenant_id = _tenant;

    -- Modelo novo: escalares + colecao TEXTO (v3) + custos stored (v3) + semana herdada. REF vazia.
    insert into modelos (
      tenant_id, nome, colecao, colecao_id, subcolecao, mes_id, ano_id,
      linha_id, categoria_principal_id, categoria_secundaria_id, subcategoria1_id, subcategoria2_id,
      estilista_id, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id,
      preco_venda, preco_atacado, markup_editado, proporcoes, custos_adicionais, custo_simulado,
      custo_terceirizados_previsto, custo_peca_previsto, custo_tecido_total, custo_forro_total,
      custo_entretela_total, custo_aviamento_total,
      observacoes_tecnicas, observacoes_gerais, observacoes_mao_obra,
      fotos_modelo, fotos_referencia, croqui_url, desenho_tecnico_url, tecidos_planejados,
      origem, status_planejamento, ordem_criacao_enviada, lancado, data_lancamento, semana,
      versao, modelo_base_id, mix_id
    ) values (
      _tenant, o.nome, v_col_nome, _destino_colecao_id, v_sub_nome, v_mes, v_ano,
      o.linha_id, o.categoria_principal_id, o.categoria_secundaria_id, o.subcategoria1_id, o.subcategoria2_id,
      o.estilista_id, o.modelista_id, o.piloteiro1_id, o.piloteiro2_id, o.piloteiro3_id,
      o.preco_venda, o.preco_atacado, o.markup_editado, o.proporcoes, o.custos_adicionais, coalesce(o.custo_simulado, '{}'::jsonb),
      o.custo_terceirizados_previsto, o.custo_peca_previsto, o.custo_tecido_total, o.custo_forro_total,
      o.custo_entretela_total, o.custo_aviamento_total,
      o.observacoes_tecnicas, o.observacoes_gerais, o.observacoes_mao_obra,
      o.fotos_modelo, o.fotos_referencia, o.croqui_url, o.desenho_tecnico_url, o.tecidos_planejados,
      'interno', 'em_planejamento', false, false, o.data_lancamento, o.semana,
      v_versao, v_root, o.mix_id
    ) returning id into v_novo;

    -- BOM PROFUNDO. Tecido/forro/entretela + variantes BLOCO-A-BLOCO (loop por bloco de origem).
    for mt_old in select * from modelo_tecidos where modelo_id = o.id order by numero, tipo, id loop
      insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto)
      values (v_novo, mt_old.artigo_id, mt_old.numero, mt_old.tipo, mt_old.consumo, mt_old.loss_percent, mt_old.custo_previsto)
      returning id into v_novo_mt;
      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
      select v_novo_mt, mtv.variante_tecido_id, mtv.ordem, mtv.multiplicador, mtv.complementa_variante_ids
        from modelo_tecido_variantes mtv where mtv.modelo_tecido_id = mt_old.id;
    end loop;

    insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
    select v_novo, variante_numero, grades, grade_total from modelo_grades where modelo_id = o.id;

    insert into modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id)
    select v_novo, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id
      from modelo_aviamentos where modelo_id = o.id;

    insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
    select _tenant, v_novo, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto
      from modelo_etiquetas where modelo_id = o.id;

    insert into modelo_observacoes (tenant_id, modelo_id, ordem, descricao, observacao)
    select _tenant, v_novo, ordem, descricao, observacao from modelo_observacoes where modelo_id = o.id;

    insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado, motivo_reprovacao, observacoes)
    select _tenant, v_novo, categoria_terceirizado_id, valor, null, null, observacoes
      from modelo_servico_mo where modelo_id = o.id;

    -- (3b) LINHA do bucket certo: casa (linha_id, categoria_id) do modelo → slot no bucket do OTB.
    select id into v_ln from plan_tecido_linhas
      where sub_id = v_sub_pt
        and linha_id is not distinct from o.linha_id
        and categoria_id is not distinct from o.categoria_principal_id
      order by ordem limit 1;
    if v_ln is null then
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
      values (v_sub_pt, o.linha_id, o.categoria_principal_id,
              coalesce((select max(ordem) + 1 from plan_tecido_linhas where sub_id = v_sub_pt), 0))
      returning id into v_ln;
    end if;

    select sl.id into v_slot
      from plan_tecido_slots sl
      where sl.linha_ref_id = v_ln and sl.modelo_id is null
      order by sl.slot_index
      limit 1 for update skip locked;

    if v_slot is not null then
      update plan_tecido_slots set modelo_id = v_novo where id = v_slot;
    else
      select coalesce(max(slot_index), -1) + 1 into v_slot_idx
        from plan_tecido_slots where linha_ref_id = v_ln;
      insert into plan_tecido_slots (linha_ref_id, modelo_id, slot_index, nome, preco_venda,
                                     categoria_id, custos_adicionais, custo_simulado)
      values (v_ln, v_novo, v_slot_idx, o.nome, o.preco_venda,
              o.categoria_principal_id, o.custos_adicionais, coalesce(o.custo_simulado, '{}'::jsonb))
      returning id into v_slot;
    end if;

    -- (3c) Copia materiais/variantes/proporcoes/categoria_tecido do slot ORIGEM (se houver) → destino.
    delete from plan_tecido_materiais where slot_id = v_slot;
    with src as (
      select ps.id as slot_id from plan_tecido_slots ps
        where ps.modelo_id = o.id and ps.tenant_id = _tenant limit 1
    ), mats as (
      insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
      select v_slot, pm.artigo_id, pm.tipo, pm.numero, pm.consumo, pm.loss_percent, pm.ordem
        from plan_tecido_materiais pm join src on pm.slot_id = src.slot_id
      returning id, tipo, numero
    )
    insert into plan_tecido_variantes (material_id, variante_tecido_id, ordem, multiplicador, grades, grade_total, cor_id, cor_apelido_id)
    select m.id, pv.variante_tecido_id, pv.ordem, pv.multiplicador, pv.grades, pv.grade_total, pv.cor_id, pv.cor_apelido_id
      from plan_tecido_variantes pv
      join plan_tecido_materiais pm_old on pm_old.id = pv.material_id
      join src on pm_old.slot_id = src.slot_id
      join mats m on m.tipo = pm_old.tipo and m.numero = pm_old.numero;
    update plan_tecido_slots dst set
      proporcoes = coalesce((select proporcoes from plan_tecido_slots where modelo_id = o.id and tenant_id = _tenant limit 1), dst.proporcoes),
      categoria_tecido_id = coalesce((select categoria_tecido_id from plan_tecido_slots where modelo_id = o.id and tenant_id = _tenant limit 1), dst.categoria_tecido_id)
    where dst.id = v_slot;

    v_out := v_out || jsonb_build_object('origem_modelo_id', o.id, 'novo_modelo_id', v_novo, 'slot_id', v_slot);
  end loop;

  return v_out;
end $function$;

REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],int) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
