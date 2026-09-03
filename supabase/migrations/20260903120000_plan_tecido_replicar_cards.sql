-- Replicar card(s) do Plan. Tecido para outra (coleção, subcoleção).
-- Cada card selecionado (modelo materializado) vira uma CÓPIA no destino: um `modelos` novo,
-- VERSIONADO (modelo_base_id = raiz da família do original, versao = max+1), com o BOM PROFUNDO
-- copiado (tecido/forro/variantes/grade + aviamentos + etiquetas + observações + MO + escalares +
-- foto por PATH), ocupando VAGAS vazias do destino primeiro (senão cria slot novo). O OTB reconta
-- sozinho (conta modelos por colecao_id+subcolecao-nome). REVENDA é BLOQUEADA nesta rodada.
--
-- Padrão wrapper + _core + REVOKE dos TRÊS (invariante #9). Não-destrutiva (só CREATE/INSERT).

BEGIN;

CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(
  _tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _modelo_ids uuid[], _rev_base int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_sub_nome text; v_mes uuid; v_ano uuid;
  v_plan uuid; v_sub_pt uuid; v_ln uuid; v_rev int;
  v_mid uuid; v_root uuid; v_versao int; v_novo uuid; v_slot uuid; v_slot_idx int;
  o record; v_out jsonb := '[]'::jsonb;
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
  select mes_id, ano_id into v_mes, v_ano from colecoes where id = _destino_colecao_id;

  -- Bloqueio de REVENDA (nesta rodada só cards internos — revenda tem fluxo próprio, invariante #13).
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

  -- (2) Garante plan_tecido + subcoleção-do-plano + ≥1 linha catch-all no DESTINO.
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
    -- Modo sem subcoleção: linha da "sub" nula do plano (subcolecao_id null).
    select id into v_sub_pt from plan_tecido_subcolecoes
      where plan_id = v_plan and subcolecao_id is null limit 1;
    if v_sub_pt is null then
      insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, null, 0) returning id into v_sub_pt;
    end if;
  end if;

  select id into v_ln from plan_tecido_linhas where sub_id = v_sub_pt order by ordem limit 1;
  if v_ln is null then
    insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
    values (v_sub_pt, null, null, 0) returning id into v_ln;
  end if;

  -- (3) Por modelo origem.
  for o in select * from modelos where id = any(_modelo_ids) and tenant_id = _tenant for update loop
    v_mid := o.id;
    -- Versão: raiz da família + max+1 (cobre a família em qualquer coleção).
    v_root := coalesce(o.modelo_base_id, o.id);
    select coalesce(max(versao), 1) + 1 into v_versao
      from modelos where (id = v_root or modelo_base_id = v_root) and tenant_id = _tenant;

    -- Modelo novo: copia escalares, overrides de destino/versão. REF nasce vazia (só ao chegar ao Dev).
    insert into modelos (
      tenant_id, nome, colecao_id, subcolecao, mes_id, ano_id,
      linha_id, categoria_principal_id, categoria_secundaria_id, subcategoria1_id, subcategoria2_id,
      estilista_id, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id,
      preco_venda, preco_atacado, markup_editado, proporcoes, custos_adicionais, custo_simulado,
      custo_terceirizados_previsto, observacoes_tecnicas, observacoes_gerais, observacoes_mao_obra,
      fotos_modelo, fotos_referencia, croqui_url, desenho_tecnico_url, tecidos_planejados,
      origem, status_planejamento, ordem_criacao_enviada, lancado, data_lancamento,
      versao, modelo_base_id, mix_id
    ) values (
      _tenant, o.nome, _destino_colecao_id, v_sub_nome, v_mes, v_ano,
      o.linha_id, o.categoria_principal_id, o.categoria_secundaria_id, o.subcategoria1_id, o.subcategoria2_id,
      o.estilista_id, o.modelista_id, o.piloteiro1_id, o.piloteiro2_id, o.piloteiro3_id,
      o.preco_venda, o.preco_atacado, o.markup_editado, o.proporcoes, o.custos_adicionais, coalesce(o.custo_simulado, '{}'::jsonb),
      o.custo_terceirizados_previsto, o.observacoes_tecnicas, o.observacoes_gerais, o.observacoes_mao_obra,
      o.fotos_modelo, o.fotos_referencia, o.croqui_url, o.desenho_tecnico_url, o.tecidos_planejados,
      'interno', 'em_planejamento', false, false, null,
      v_versao, v_root, o.mix_id
    ) returning id into v_novo;

    -- BOM PROFUNDO — cópia modelo→modelo (INSERT…SELECT), remapeando o modelo_tecido_id das variantes.
    -- Tecidos (todos os tipos: tecido/forro/entretela).
    with novos as (
      insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto)
      select v_novo, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto
        from modelo_tecidos where modelo_id = v_mid
      returning id, artigo_id, numero, tipo
    )
    insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
    select n.id, mtv.variante_tecido_id, mtv.ordem, mtv.multiplicador, mtv.complementa_variante_ids
      from modelo_tecido_variantes mtv
      join modelo_tecidos mt_old on mt_old.id = mtv.modelo_tecido_id and mt_old.modelo_id = v_mid
      join novos n on n.artigo_id is not distinct from mt_old.artigo_id and n.numero = mt_old.numero and n.tipo = mt_old.tipo;

    -- Grade (por variante_numero).
    insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
    select v_novo, variante_numero, grades, grade_total from modelo_grades where modelo_id = v_mid;

    -- Aviamentos.
    insert into modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id)
    select v_novo, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id
      from modelo_aviamentos where modelo_id = v_mid;

    -- Etiquetas/insumos.
    insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
    select _tenant, v_novo, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto
      from modelo_etiquetas where modelo_id = v_mid;

    -- Observações.
    insert into modelo_observacoes (tenant_id, modelo_id, ordem, descricao, observacao)
    select _tenant, v_novo, ordem, descricao, observacao from modelo_observacoes where modelo_id = v_mid;

    -- MO por serviço: copia valores, ZERA aprovação (aprovado=NULL → não dispara o gate #12; re-aprovar).
    insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado, motivo_reprovacao, observacoes)
    select _tenant, v_novo, categoria_terceirizado_id, valor, null, null, observacoes
      from modelo_servico_mo where modelo_id = v_mid;
    -- NÃO copiar: modelo_tecido_oc_links, cad, lancamentos, kanban_historico, prova, snapshots.

    -- (3b) Ocupa vaga vazia do destino (ordem slot_index) OU cria slot novo.
    select sl.id into v_slot
      from plan_tecido_slots sl
      join plan_tecido_linhas l on l.id = sl.linha_ref_id
      where l.sub_id = v_sub_pt and sl.modelo_id is null
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

    -- (3c) Copia materiais/variantes/proporcoes/categoria_tecido do slot ORIGEM (se o modelo tem slot
    -- no plano de origem) para o slot destino — a exibição/prévia lê o slot. Se o origem não tiver slot
    -- (modelo criado fora do Plan. Tecido), a exibição cai no merge do BOM vivo do modelo (aceitável).
    delete from plan_tecido_materiais where slot_id = v_slot;
    with src as (
      select ps.id as slot_id, ps.proporcoes, ps.categoria_tecido_id
        from plan_tecido_slots ps where ps.modelo_id = v_mid and ps.tenant_id = _tenant limit 1
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
    -- proporcoes/categoria_tecido do slot destino a partir do slot origem.
    update plan_tecido_slots dst set
      proporcoes = coalesce((select proporcoes from plan_tecido_slots where modelo_id = v_mid and tenant_id = _tenant limit 1), dst.proporcoes),
      categoria_tecido_id = coalesce((select categoria_tecido_id from plan_tecido_slots where modelo_id = v_mid and tenant_id = _tenant limit 1), dst.categoria_tecido_id)
    where dst.id = v_slot;

    v_out := v_out || jsonb_build_object('origem_modelo_id', v_mid, 'novo_modelo_id', v_novo, 'slot_id', v_slot);
  end loop;

  -- Bump do plan_rev do DESTINO: o `insert into plan_tecido … on conflict do update` (passo 2) JÁ
  -- dispara `trg_colab_bump` em plan_tecido → `fn_colab_bump_plan` → +1 em colecoes.plan_rev. NÃO
  -- há UPDATE colecoes explícito aqui (senão o rev subiria +2 e o próximo save da coleção aberta
  -- daria P0409 falso). O front trata a mudança de rev por refetch (não assume delta fixo).
  return v_out;
end $function$;

-- Wrapper: gate de módulo + repassa o tenant do chamador.
CREATE OR REPLACE FUNCTION public.replicar_cards_plan_tecido(
  _destino_colecao_id uuid, _destino_subcolecao_id uuid, _modelo_ids uuid[], _rev_base int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_tenant uuid;
begin
  if not public.tenant_module_enabled('criacao') then
    raise exception 'Módulo de Criação não está ativo.' using errcode = '42501';
  end if;
  v_tenant := public.get_user_tenant_id();
  return public._replicar_cards_plan_tecido_core(v_tenant, _destino_colecao_id, _destino_subcolecao_id, _modelo_ids, _rev_base);
end $function$;

-- ACL (invariante #9): _core revogado dos TRÊS; wrapper só p/ authenticated.
REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.replicar_cards_plan_tecido(uuid,uuid,uuid[],int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.replicar_cards_plan_tecido(uuid,uuid,uuid[],int) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
