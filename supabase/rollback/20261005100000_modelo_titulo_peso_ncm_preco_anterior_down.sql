-- INVERSO da 20261005100000_modelo_titulo_peso_ncm_preco_anterior.sql (F3.6 Parte B). ARQUIVO GERADO (gerar_sql.py).
-- ⚠️ APAGA o que foi digitado em Título para a página, Peso/medidas, NCM e Preço anterior (DROP COLUMN ×7 em modelos) e nas
-- Keywords da loja (DROP COLUMN keywords em tenant_config). Só com OK do dono e DEPOIS de tirar do ar o front que grava as
-- colunas (senão todo Salvar do Planejamento cai com PGRST204).
-- GUARDA: com QUALQUER um desses campos preenchido o script ABORTA, a menos que a MESMA transação tenha
--   SET LOCAL app.confirmo_apagar_campos_sheet = 'sim'
-- (o volta-producao.sh exporta antes e injeta a linha pelo EXTRA_SQL do aplica_v2).
-- Ordem: SET client_encoding = 'UTF8' ANTES do BEGIN (F1) → BEGIN/travas → LOCK TABLE modelos, tenant_config IN ACCESS
-- EXCLUSIVE MODE, NESSA ORDEM (F4 — antes da guarda de dado, para a contagem e o DROP enxergarem o MESMO estado) → guarda
-- (md5 das 5 funções + confirmação) → _replicar e as 4 funções do SKU voltam ao texto vivo de 25/set byte a byte (o SKU
-- volta a ter o padrão da loja) → REVOKE/ACL → DROP da função do título → DROP das colunas de modelos → o COMMENT antigo de
-- modelos.tamanho_tipo → DROP de keywords POR ÚLTIMO → pós-condição (bloco PL/pgSQL "$pos$", F2: md5 das 5 = o vivo, colunas + keywords
-- sumiram) → NOTIFY pgrst, 'reload schema' (F5) → COMMIT. Idempotente. Travas no arquivo (500 ms / 3 s).
-- P-25: tira SÓ o DEFAULT 'letra' de tamanho_tipo — o backfill (NULL → letra) NÃO é desfeito: não há como saber quem
-- era NULL (R44).
-- Voltar a F3.5a (SKU) DEPOIS desta frente exige rodar ESTE inverso antes (R36).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';
LOCK TABLE public.modelos, public.tenant_config IN ACCESS EXCLUSIVE MODE;

DO $guarda$
DECLARE
  v_md5 text;
  v_n bigint := 0;
  v_k bigint := 0;
BEGIN
  IF to_regprocedure('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)') IS NULL THEN
    RAISE EXCEPTION 'sheet_reorg: _replicar_cards_plan_tecido_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)')));
  IF v_md5 NOT IN ('4898c806fc043e9392f68385a446e844', 'cd89885741a32a63cbfa899d31ac0661') THEN
    RAISE EXCEPTION 'sheet_reorg: _replicar_cards_plan_tecido_core não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 6) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._sku_config_normaliza(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'sheet_reorg: _sku_config_normaliza não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._sku_config_normaliza(jsonb)')));
  IF v_md5 NOT IN ('a32359d01656562986e67b06d06c4c8e', '7714c95d1cc43e6da89c14e8090f46a0') THEN
    RAISE EXCEPTION 'sheet_reorg: _sku_config_normaliza não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 6) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_modelo_calc(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sheet_reorg: _skus_modelo_calc não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_calc(uuid)')));
  IF v_md5 NOT IN ('b4a8716d110a77d72a04b64fb86cc623', '56c3c48067e07b4cfbcdcf0dccdb5ae6') THEN
    RAISE EXCEPTION 'sheet_reorg: _skus_modelo_calc não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 6) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_modelo_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sheet_reorg: _skus_modelo_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_core(uuid)')));
  IF v_md5 NOT IN ('a0d3bf2927c4664c9a152a8256fd6e40', 'f77fddb7bbfab7025b5f5f5007ede931') THEN
    RAISE EXCEPTION 'sheet_reorg: _skus_modelo_core não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 6) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._gerar_skus_modelo_core(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'sheet_reorg: _gerar_skus_modelo_core não existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._gerar_skus_modelo_core(uuid,boolean)')));
  IF v_md5 NOT IN ('42d6bec530122feda4147fbc4fbc898c', '5f523d3dabda04bcda684ddf2cac0459') THEN
    RAISE EXCEPTION 'sheet_reorg: _gerar_skus_modelo_core não está nem no texto vivo de 25/set nem no desta migration (md5 %) — outra frente mudou; regenerar a migration (plano, Task 6) antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'modelos' AND column_name = 'titulo_pagina') THEN
    EXECUTE $q$SELECT count(*) FROM public.modelos WHERE length(btrim(coalesce(titulo_pagina, ''))) > 0 OR peso_kg IS NOT NULL OR comprimento_cm IS NOT NULL OR largura_cm IS NOT NULL OR altura_cm IS NOT NULL OR length(btrim(coalesce(ncm, ''))) > 0 OR preco_anterior IS NOT NULL$q$ INTO v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_config' AND column_name = 'keywords') THEN
    EXECUTE $q$SELECT count(*) FROM public.tenant_config WHERE length(btrim(coalesce(keywords, ''))) > 0$q$ INTO v_k;
  END IF;
  IF (v_n > 0 OR v_k > 0) AND coalesce(current_setting('app.confirmo_apagar_campos_sheet', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'Há % modelo(s) com Título para a página, Peso/medidas, NCM ou Preço anterior e % loja(s) com Keywords preenchidos — o DROP COLUMN apaga esses dados. Exporte antes (volta-producao.sh) e rode de novo com SET LOCAL app.confirmo_apagar_campos_sheet = ''sim'' na MESMA transação (EXTRA_SQL do aplica_v2).', v_n, v_k USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(_tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _modelo_ids uuid[], _rev_base integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

    -- Modelo novo: escalares + colecao TEXTO (v3) + custos stored (v3) + semana herdada.
    -- REF do original MANTIDA (copia ref/ref_auto — regra do dono; o card nasce
    -- ordem_criacao_enviada=false, então fn_modelo_ref_auto não sobrescreve).
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
      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto
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
      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto
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

REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._sku_config_normaliza(_c jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partes jsonb;
  v_seps jsonb;
  v_out_partes jsonb := '[]'::jsonb;
  v_out_seps jsonb := '{}'::jsonb;
  v_p jsonb;
  v_t text;
  v_prev text := NULL;
  v_sep jsonb;
  v_s text;
  v_tipo text;
BEGIN
  IF _c IS NULL OR jsonb_typeof(_c) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_c) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido.' USING ERRCODE = 'P0001';
  END IF;
  v_partes := _c -> 'partes';
  IF v_partes IS NULL OR jsonb_typeof(v_partes) = 'null' THEN
    v_partes := '[]'::jsonb;
  ELSIF jsonb_typeof(v_partes) <> 'array' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: partes.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_p IN SELECT e.value FROM jsonb_array_elements(v_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_p) <> 'string' OR (v_p #>> '{}') NOT IN ('ref', 'cor_base', 'cor_apelido', 'tamanho') THEN
      RAISE EXCEPTION 'Parte do SKU desconhecida: %.', v_p::text USING ERRCODE = 'P0001';
    END IF;
    IF v_out_partes @> jsonb_build_array(v_p) THEN
      RAISE EXCEPTION 'Parte do SKU repetida: %.', v_p #>> '{}' USING ERRCODE = 'P0001';
    END IF;
    v_out_partes := v_out_partes || jsonb_build_array(v_p);
  END LOOP;
  IF jsonb_array_length(v_out_partes) = 0 THEN
    RETURN NULL;
  END IF;
  v_seps := _c -> 'separadores';
  IF v_seps IS NULL OR jsonb_typeof(v_seps) = 'null' THEN
    v_seps := '{}'::jsonb;
  ELSIF jsonb_typeof(v_seps) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: separadores.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_t IN SELECT e.value FROM jsonb_array_elements_text(v_out_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF v_prev IS NOT NULL THEN
      v_sep := v_seps -> (v_prev || '|' || v_t);
      IF v_sep IS NOT NULL AND jsonb_typeof(v_sep) <> 'null' THEN
        IF jsonb_typeof(v_sep) <> 'string' THEN
          RAISE EXCEPTION 'Separador do SKU inválido.' USING ERRCODE = 'P0001';
        END IF;
        v_s := v_sep #>> '{}';
        IF v_s !~ '^[-._/]*$' THEN
          RAISE EXCEPTION 'Separador do SKU: use só - . _ /.' USING ERRCODE = 'P0001';
        END IF;
        IF char_length(v_s) > 3 THEN
          RAISE EXCEPTION 'Separador do SKU: no máximo 3 caracteres.' USING ERRCODE = 'P0001';
        END IF;
        IF v_s <> '' THEN
          v_out_seps := v_out_seps || jsonb_build_object(v_prev || '|' || v_t, v_s);
        END IF;
      END IF;
    END IF;
    v_prev := v_t;
  END LOOP;
  v_tipo := coalesce(nullif(_c ->> 'tamanho_padrao', ''), 'letra');
  IF v_tipo NOT IN ('letra', 'numero') THEN
    RAISE EXCEPTION 'Tamanho padrão do SKU inválido (use letra ou número).' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('partes', v_out_partes, 'separadores', v_out_seps, 'tamanho_padrao', v_tipo);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._sku_config_normaliza(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._skus_modelo_calc(_modelo_id uuid)
 RETURNS TABLE(variante_key uuid, variante_ordem integer, cor_nome text, apelido_nome text, tamanho_key text, tamanho_ordem integer, sku text, faltas jsonb, avisos jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH m AS (
    SELECT mo.id AS mid,
           mo.ref AS mref,
           coalesce(mo.origem, 'interno') AS morigem,
           coalesce(mo.tamanho_tipo, tc.sku_config ->> 'tamanho_padrao', 'letra') AS mtipo,
           tc.sku_config AS mcfg,
           tc.tamanhos_sku AS mtsku,
           CASE WHEN jsonb_typeof(tc.tamanhos_grade) = 'array' THEN tc.tamanhos_grade ELSE '[]'::jsonb END AS mgrade
      FROM public.modelos mo
      LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
     WHERE mo.id = _modelo_id
  ),
  va AS (
    SELECT public._sku_variante_key(vt.cor_id, vt.cor_apelido_id) AS vkey, mtv.ordem AS vordem,
           vt.cor_id AS vcor, vt.cor_apelido_id AS vapelido
      FROM m
      JOIN public.modelo_tecidos mt ON mt.modelo_id = m.mid AND mt.tipo = 'tecido' AND mt.numero = 1
      JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
      JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
     WHERE m.morigem = 'interno'
    UNION ALL
    SELECT public._sku_variante_key(pv.cor_id, pv.cor_apelido_id), pv.ordem, pv.cor_id, pv.cor_apelido_id
      FROM m
      JOIN public.produtos_acabados pa ON pa.modelo_id = m.mid
      JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
     WHERE m.morigem = 'revenda'
    UNION ALL
    SELECT public._sku_variante_key(iv.cor_id, iv.cor_apelido_id), iv.ordem, iv.cor_id, iv.cor_apelido_id
      FROM m
      JOIN public.produtos_importados pi ON pi.modelo_id = m.mid
      JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
     WHERE m.morigem = 'importado'
  ),
  vs AS (
    SELECT DISTINCT ON (va.vkey) va.vkey, va.vordem, va.vcor, va.vapelido
      FROM va
     ORDER BY va.vkey, va.vordem
  ),
  tam AS (
    SELECT va.vkey AS tvkey, e.key AS tkey
      FROM va
      JOIN public.modelo_grades g ON g.modelo_id = _modelo_id AND g.variante_numero = va.vordem
      CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(g.grades) = 'object' THEN g.grades ELSE '{}'::jsonb END) AS e
     GROUP BY va.vkey, e.key
    HAVING sum(CASE
                 WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric
                 WHEN jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}') ~ '^[0-9]+(\.[0-9]+)?$'
                   THEN btrim(e.value #>> '{}')::numeric
                 ELSE 0
               END) > 0
  )
  SELECT vs.vkey,
         vs.vordem,
         c.nome::text,
         a.nome::text,
         tam.tkey,
         coalesce((SELECT o.n::integer
                     FROM jsonb_array_elements_text(m.mgrade) WITH ORDINALITY AS o(t, n)
                    WHERE o.t = tam.tkey
                    ORDER BY o.n
                    LIMIT 1), 9999),
         r.res ->> 'sku',
         r.res -> 'faltas',
         r.res -> 'avisos'
    FROM m
    JOIN vs ON true
    JOIN tam ON tam.tvkey = vs.vkey
    LEFT JOIN public.cores c ON c.id = vs.vcor
    LEFT JOIN public.cores_apelido a ON a.id = vs.vapelido
    CROSS JOIN LATERAL (
      SELECT public._sku_resolver(
               m.mcfg,
               m.mref,
               CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('id', c.id, 'nome', c.nome, 'sigla', c.sigla_sku) END,
               CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id, 'nome', a.nome, 'sigla', a.sigla_sku) END,
               tam.tkey,
               m.mtipo,
               m.mtsku) AS res
    ) AS r;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._skus_modelo_calc(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._skus_modelo_core(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_tipo_card text;
  v_tipo text;
  v_status text;
  v_linhas jsonb;
  v_faltas jsonb;
  v_avisos jsonb;
BEGIN
  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config, mo.tamanho_tipo
    INTO v_tenant, v_refn, v_cfg, v_tipo_card
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_tipo := coalesce(v_tipo_card, v_cfg ->> 'tamanho_padrao', 'letra');
  v_status := CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN v_refn = '' THEN 'aguardando_ref' ELSE 'ok' END;

  IF v_status <> 'ok' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'sku', s.sku,
             'manual', s.manual, 'rev', s.rev, 'estado', CASE WHEN s.manual THEN 'manual' ELSE 'salvo' END)
             ORDER BY s.variante_key, s.tamanho_key), '[]'::jsonb)
      INTO v_linhas
      FROM public.modelo_skus s
     WHERE s.modelo_id = _modelo_id;
    RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                              'linhas', v_linhas, 'faltas', '[]'::jsonb, 'avisos', '[]'::jsonb);
  END IF;

  WITH c AS (
    SELECT * FROM public._skus_modelo_calc(_modelo_id)
  ), s AS (
    SELECT sk.id, sk.variante_key, sk.tamanho_key, sk.sku, sk.manual, sk.rev
      FROM public.modelo_skus sk
     WHERE sk.modelo_id = _modelo_id
  ), j AS (
    SELECT c.variante_key AS c_vkey, s.variante_key AS s_vkey, c.variante_ordem AS vordem, c.cor_nome, c.apelido_nome,
           coalesce(c.tamanho_key, s.tamanho_key) AS tkey, c.tamanho_ordem AS tordem, c.sku AS previsto,
           coalesce(c.faltas, '[]'::jsonb) AS faltas, coalesce(c.avisos, '[]'::jsonb) AS avisos, s.id AS sid, s.sku AS salvo, s.manual, s.rev
      FROM c
      FULL JOIN s ON s.variante_key = c.variante_key AND s.tamanho_key = c.tamanho_key
  ), k AS (
    SELECT j.*,
           -- o SKU GRAVADO divide com outra linha que não é réplica (REF viva) — ex.: a REF de um card mudou (R2-a)
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.salvo AND o.id <> j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND o.variante_key = coalesce(j.c_vkey, j.s_vkey) AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_salvo,
           -- o SKU PREVISTO (o que a geração gravaria) já é de outra linha que não é réplica
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.previsto AND o.id IS DISTINCT FROM j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND o.variante_key = j.c_vkey AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_prev
      FROM j
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variante_key', coalesce(k.c_vkey, k.s_vkey), 'variante_ordem', k.vordem,
           'cor_nome', k.cor_nome, 'apelido_nome', k.apelido_nome,
           'tamanho_key', k.tkey, 'tamanho_ordem', k.tordem,
           'id', k.sid, 'sku', k.salvo, 'manual', coalesce(k.manual, false), 'rev', k.rev,
           'sku_previsto', k.previsto, 'faltas', k.faltas, 'avisos', k.avisos,
           'conflito_com', coalesce(k.conflito_salvo, k.conflito_prev),
           'estado', CASE
             WHEN k.c_vkey IS NULL THEN 'orfa'
             WHEN k.conflito_salvo IS NOT NULL THEN 'conflito'
             WHEN k.manual IS TRUE THEN 'manual'
             WHEN jsonb_array_length(k.faltas) > 0 THEN 'falta'
             WHEN k.previsto IS NULL THEN 'vazio'
             WHEN k.salvo = k.previsto THEN 'ok'
             WHEN k.conflito_prev IS NOT NULL THEN 'conflito'
             WHEN k.salvo IS NULL THEN 'pendente'
             ELSE 'divergente'
           END)
           ORDER BY k.vordem NULLS LAST, k.tordem NULLS LAST, k.tkey), '[]'::jsonb)
    INTO v_linhas
    FROM k;

  SELECT coalesce(jsonb_agg(DISTINCT f.value ORDER BY f.value), '[]'::jsonb)
    INTO v_faltas
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'faltas') AS f(value)
   WHERE l.value ->> 'estado' = 'falta';

  SELECT coalesce(jsonb_agg(DISTINCT a.value ORDER BY a.value), '[]'::jsonb)
    INTO v_avisos
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'avisos') AS a(value);

  RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                            'linhas', v_linhas, 'faltas', v_faltas, 'avisos', v_avisos);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._skus_modelo_core(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._gerar_skus_modelo_core(_modelo_id uuid, _regerar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  l record;
  v_id uuid;
  v_sku text;
  v_manual boolean;
  v_criados integer := 0;
  v_atualizados integer := 0;
  v_removidos integer := 0;
  v_conflitos jsonb := '[]'::jsonb;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
  v_com_vkey uuid;
  v_com_tkey text;
  v_com_sku_atual text;
  v_com_sku_novo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;

  -- Uma geração/edição por modelo de cada vez (duas abas/pessoas no mesmo card esperam em fila). 1ª trava da ordem
  -- única (sku_modelo → linha → sku_unico): a edição à mão pega a MESMA antes de travar a linha — sem deadlock.
  -- Trava com o MÍNIMO (só _modelo_id, igual _salvar_sku_manual_core); REF e Formato só são lidos DEPOIS da trava,
  -- já sob a garantia de que ninguém mais gera/edita este modelo ao mesmo tempo.
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));

  SELECT mo.tenant_id, public._sku_norm_ref(mo.ref), tc.sku_config
    INTO v_tenant, v_refn, v_cfg
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;

  IF v_cfg IS NOT NULL AND v_refn <> '' THEN
    IF _regerar THEN
      -- Automáticas que saíram da grade (variante/cor removida, tamanho zerado) saem ANTES de gerar. Manual: nunca.
      DELETE FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id
         AND NOT s.manual
         AND (s.variante_key, s.tamanho_key) NOT IN (
               SELECT c.variante_key, c.tamanho_key FROM public._skus_modelo_calc(_modelo_id) AS c);
      GET DIAGNOSTICS v_removidos = ROW_COUNT;
    END IF;

    FOR l IN SELECT c.variante_key, c.tamanho_key, c.sku
               FROM public._skus_modelo_calc(_modelo_id) AS c
              ORDER BY c.variante_ordem, c.tamanho_ordem, c.tamanho_key LOOP
      v_id := NULL;
      v_sku := NULL;
      v_manual := NULL;
      SELECT s.id, s.sku, s.manual INTO v_id, v_sku, v_manual
        FROM public.modelo_skus s
       WHERE s.modelo_id = _modelo_id AND s.variante_key = l.variante_key AND s.tamanho_key = l.tamanho_key;
      CONTINUE WHEN v_manual IS TRUE;                                          -- editado à mão: nunca (Q2)
      CONTINUE WHEN l.sku IS NULL;                                             -- falta sigla (Q4) / vazio
      CONTINUE WHEN v_id IS NOT NULL AND (NOT _regerar OR v_sku = l.sku);      -- fixo (Q2) ou já igual
      BEGIN
        IF v_id IS NULL THEN
          INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
          VALUES (v_tenant, _modelo_id, l.variante_key, l.tamanho_key, l.sku, false, now());
          v_criados := v_criados + 1;
        ELSE
          UPDATE public.modelo_skus SET sku = l.sku, gerado_em = now(), rev = rev + 1 WHERE id = v_id;
          v_atualizados := v_atualizados + 1;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        v_com_modelo := NULL;
        v_com_nome := NULL;
        v_com_ref := NULL;
        v_com_vkey := NULL;
        v_com_tkey := NULL;
        v_com_sku_atual := NULL;
        v_com_sku_novo := NULL;
        SELECT o.modelo_id, mo.nome, mo.ref, o.variante_key, o.tamanho_key, o.sku
          INTO v_com_modelo, v_com_nome, v_com_ref, v_com_vkey, v_com_tkey, v_com_sku_atual
          FROM public.modelo_skus o
          JOIN public.modelos mo ON mo.id = o.modelo_id
         WHERE o.tenant_id = v_tenant AND o.sku = l.sku
           AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                    AND o.variante_key = l.variante_key AND o.tamanho_key = l.tamanho_key)
         ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
         LIMIT 1;
        -- Caso especial (troca de siglas A↔B no mesmo produto): a linha conflitante é OUTRA linha deste
        -- MESMO card que também vai mudar de SKU neste Regerar (ela ainda não passou pelo loop, ou o SKU
        -- novo dela é diferente do que está gravado hoje). Não são "duas linhas com o mesmo SKU" — é a
        -- ORDEM do Regerar que ainda não trocou a outra; a regra de unicidade continua barrando a troca
        -- (fica para a F3.5b), mas o texto não deve afirmar uma colisão de configuração que não existe.
        IF v_com_modelo = _modelo_id THEN
          SELECT c.sku INTO v_com_sku_novo
            FROM public._skus_modelo_calc(_modelo_id) AS c
           WHERE c.variante_key = v_com_vkey AND c.tamanho_key = v_com_tkey;
        END IF;
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'variante_key', l.variante_key, 'tamanho_key', l.tamanho_key, 'sku', l.sku,
          'com_modelo_id', v_com_modelo, 'com_nome', v_com_nome, 'com_ref', v_com_ref,
          'mensagem', CASE
            WHEN v_com_modelo IS NULL THEN
              format('SKU %s não gravado: outra pessoa gravou esta linha agora. Gere de novo.', l.sku)
            WHEN v_com_modelo = _modelo_id AND v_com_sku_novo IS NOT NULL AND v_com_sku_novo IS DISTINCT FROM v_com_sku_atual THEN
              format('SKU %s não gravado: esta linha colide com outra deste produto que também muda de SKU neste Regerar. Ajuste um SKU à mão e rode o Regerar de novo.', l.sku)
            WHEN v_com_modelo = _modelo_id THEN
              format('SKU %s repetido neste produto: duas linhas dão o mesmo SKU. Mude uma sigla ou edite um deles à mão.', l.sku)
            ELSE
              format('SKU %s já existe em %s (REF %s). Edite este SKU à mão ou mude a sigla.', l.sku,
                     coalesce(v_com_nome, 'outro produto'), coalesce(nullif(btrim(v_com_ref), ''), '—'))
          END));
      END;
    END LOOP;
  END IF;

  RETURN public._skus_modelo_core(_modelo_id)
      || jsonb_build_object('criados', v_criados, 'atualizados', v_atualizados, 'removidos', v_removidos,
                            'conflitos', v_conflitos);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._gerar_skus_modelo_core(uuid, boolean) FROM PUBLIC, anon, authenticated;

DO $acl$
BEGIN
  IF has_function_privilege('anon', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._sku_config_normaliza(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._sku_config_normaliza(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._skus_modelo_calc(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._skus_modelo_calc(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._skus_modelo_core(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._skus_modelo_core(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._gerar_skus_modelo_core(uuid,boolean)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._gerar_skus_modelo_core(uuid,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'sheet_reorg: função interna ficou executável por anon/authenticated (invariante #9)' USING ERRCODE = 'P0001';
  END IF;
END
$acl$;

DROP FUNCTION IF EXISTS public._titulo_pagina_calculado(text, text);

-- POR ÚLTIMO: ACCESS EXCLUSIVE em `modelos` (e, no fim, em tenant_config) só daqui até o COMMIT.
ALTER TABLE public.modelos
  DROP COLUMN IF EXISTS titulo_pagina,
  DROP COLUMN IF EXISTS peso_kg,
  DROP COLUMN IF EXISTS comprimento_cm,
  DROP COLUMN IF EXISTS largura_cm,
  DROP COLUMN IF EXISTS altura_cm,
  DROP COLUMN IF EXISTS ncm,
  DROP COLUMN IF EXISTS preco_anterior,
  ALTER COLUMN tamanho_tipo DROP DEFAULT;
COMMENT ON COLUMN public.modelos.tamanho_tipo IS '"Tamanho em" do card (F3.5): letra | numero; NULL = padrão da loja (tenant_config.sku_config.tamanho_padrao).';

ALTER TABLE public.tenant_config DROP COLUMN IF EXISTS keywords;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)')));
  IF v_md5 <> '4898c806fc043e9392f68385a446e844' THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — _replicar_cards_plan_tecido_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._sku_config_normaliza(jsonb)')));
  IF v_md5 <> 'a32359d01656562986e67b06d06c4c8e' THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — _sku_config_normaliza não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_calc(uuid)')));
  IF v_md5 <> 'b4a8716d110a77d72a04b64fb86cc623' THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — _skus_modelo_calc não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_modelo_core(uuid)')));
  IF v_md5 <> 'a0d3bf2927c4664c9a152a8256fd6e40' THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — _skus_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._gerar_skus_modelo_core(uuid,boolean)')));
  IF v_md5 <> '42d6bec530122feda4147fbc4fbc898c' THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — _gerar_skus_modelo_core não ficou com o texto esperado (md5 %); possível corrupção (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._titulo_pagina_calculado(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — _titulo_pagina_calculado ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelos'
        AND column_name = ANY(ARRAY['titulo_pagina', 'peso_kg', 'comprimento_cm', 'largura_cm', 'altura_cm', 'ncm', 'preco_anterior'])) THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — alguma das 7 colunas de modelos ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tenant_config' AND column_name = 'keywords') THEN
    RAISE EXCEPTION 'sheet_reorg: pós-condição falhou — tenant_config.keywords ainda existe — desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
