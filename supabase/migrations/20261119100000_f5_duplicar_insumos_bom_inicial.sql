-- F5 (dono, nov/2026) — Duplicar com BOM COMPLETO: os INSUMOS tambem devem ser copiados por quem tem so a
-- pagina Planejamento (nao so Desenvolvimento). Hoje o bloco `_etiquetas` do salvar_card_planejamento exige
-- `criacao_desenvolvimento` INCONDICIONALMENTE (ao contrario do bloco `_bom`, que tem a excecao "BOM inicial":
-- modelo vazio aceita `criacao_planejamento`). Esta migration da ao `_etiquetas` a MESMA excecao.
--
-- Criterio de "inicial" para insumos (mais estrito que o do `_bom`, de proposito): o modelo nao tem NENHUMA
-- linha de BOM — sem tecidos, sem aviamentos E sem insumos. Assim a excecao so vale para card realmente novo/
-- vazio (o caso do Duplicar), e NAO abre brecha para alguem com so Planejamento adicionar insumos a um card
-- que ja tem BOM. Fora desse caso, segue exigindo `criacao_desenvolvimento` (regra de hoje, intocada).
--
-- Troca EXATA sobre o corpo vivo (md5 antes 6f80bc02ffe17bbf06bef96325c57017). So o bloco `_etiquetas` muda;
-- o `v_bom_inicial` passa a ser computado tambem quando `_etiquetas` vem (hoje so quando `_bom` vem). Nenhum
-- outro _core e redefinido. CREATE OR REPLACE (nao DROP) => nao trava auth/storage.
BEGIN;

-- Pre-condicao: o corpo vivo e o esperado (senao PARA, nada muda).
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(pg_get_functiondef('public.salvar_card_planejamento(uuid,jsonb,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure))
    INTO v_md5;
  IF v_md5 IS DISTINCT FROM '6f80bc02ffe17bbf06bef96325c57017' THEN
    RAISE EXCEPTION 'f5_duplicar_insumos: salvar_card_planejamento com corpo inesperado (md5 %) — regenere a partir do vivo', v_md5;
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.salvar_card_planejamento(_modelo_id uuid, _header jsonb, _rev_base integer, _bom jsonb, _etiquetas jsonb, _cad jsonb, _mo jsonb, _grade_revenda jsonb, _revisao jsonb, _flags jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Colunas de modelos que o Salvar do Sheet grava (Draft de modelo-shared.ts + tecidos_planejados). Lista FECHADA.
  c_header_ok constant text[] := ARRAY[
    'nome','ref','estilista_id','linha_id','colecao','colecao_id','subcolecao','semana','mes_id','ano_id',
    'categoria_principal_id','subcategoria1_id','subcategoria2_id','origem','preco_venda','preco_atacado',
    'markup_editado','data_lancamento','tecidos_planejados','status_planejamento','croqui_url','desenho_tecnico_url',
    'fotos_modelo','fotos_referencia','observacoes_gerais','observacoes_mao_obra','versao','modelo_base_id','custo_simulado',
    'modelista_id','piloteiro1_id','piloteiro2_id','piloteiro3_id','data_piloto1','data_piloto2','data_piloto3',
    'data_desenho_tecnico','data_aprovacao','observacoes_tecnicas','motivo_cancelamento','ficha_medida_url',
    'descricao_produto','proporcoes','custos_adicionais','tamanho_tipo','titulo_pagina','peso_kg','comprimento_cm',
    'largura_cm','altura_cm','ncm','preco_anterior'
  ];
  v_tenant uuid;
  v_rev integer;
  v_ruins text;
  v_sets text;
  v_bom_inicial boolean;
  v_proporcoes jsonb;
  v_marcadas jsonb := '{}'::jsonb;
BEGIN
  -- 1. login, modulo e portoes de pagina (todos ANTES de qualquer escrita; sem oraculo: id inexistente e sem permissao
  --    dao o mesmo 42501 de pagina porque o portao vem antes da busca).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento');

  -- Posse do card (sem oraculo): o id de outra loja / inexistente e recusado AQUI, antes de qualquer leitura condicional do BOM
  -- (a RPC e DEFINER: sem este check o v_bom_inicial leria o BOM de qualquer loja e a pagina exigida variaria com ele).
  -- Sem trava aqui; o FOR UPDATE (uma vez so) vem no passo 2, depois das advisory.
  SELECT m.tenant_id INTO v_tenant
    FROM public.modelos m
   WHERE m.id = _modelo_id AND (m.tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;

  -- JSON null (e nao so SQL NULL) tambem significa "bloco ausente".
  _header := NULLIF(_header, 'null'::jsonb);
  _bom := NULLIF(_bom, 'null'::jsonb);
  _etiquetas := NULLIF(_etiquetas, 'null'::jsonb);
  _cad := NULLIF(_cad, 'null'::jsonb);
  _mo := NULLIF(_mo, 'null'::jsonb);
  _grade_revenda := NULLIF(_grade_revenda, 'null'::jsonb);
  _revisao := NULLIF(_revisao, 'null'::jsonb);
  _flags := NULLIF(_flags, 'null'::jsonb);

  IF _header IS NOT NULL AND jsonb_typeof(_header) <> 'object' THEN
    RAISE EXCEPTION 'header_invalido: esperado um objeto' USING ERRCODE = 'P0001';
  END IF;
  IF _flags IS NOT NULL AND jsonb_typeof(_flags) <> 'object' THEN
    RAISE EXCEPTION 'flags_invalido: esperado um objeto' USING ERRCODE = 'P0001';
  END IF;

  -- [F5] "BOM inicial" (card novo/sem ficha) = modelo SEM tecidos E SEM aviamentos. MESMO criterio de antes (o `_bom`
  -- ja usava este), agora computado tambem quando so `_etiquetas` vem, para os DOIS blocos usarem a mesma regra.
  -- ⚠️ NAO conta insumos de proposito: um card interno recem-criado nasce com os "insumos padrao" da loja (R2) mas sem
  -- tecido — contar insumos classificaria esse card normal como "nao-inicial" e exigiria Desenvolvimento para quem tem
  -- so Planejamento montar o 1o BOM/insumo (regressao). Sem tecido/aviamento = ainda em planejamento = inicial.
  IF _bom IS NOT NULL OR _etiquetas IS NOT NULL THEN
    v_bom_inicial := NOT (EXISTS (SELECT 1 FROM public.modelo_tecidos WHERE modelo_id = _modelo_id)
                          OR EXISTS (SELECT 1 FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id));
  END IF;

  -- Portoes por bloco = os dos wrappers que a tela chamava antes.
  IF _bom IS NOT NULL THEN
    IF jsonb_typeof(_bom) <> 'object'
       OR jsonb_typeof(_bom->'tecidos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_bom->'aviamentos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_bom->'grades') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'bom_invalido: esperado tecidos, aviamentos e grades (listas)' USING ERRCODE = 'P0001';
    END IF;
    IF v_bom_inicial THEN
      PERFORM public._seg_exige_pagina('criacao_desenvolvimento', 'criacao_planejamento');
    ELSE
      PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
    END IF;
  END IF;
  IF _etiquetas IS NOT NULL THEN
    IF jsonb_typeof(_etiquetas) <> 'array' THEN
      RAISE EXCEPTION 'etiquetas_invalidas: esperado uma lista' USING ERRCODE = 'P0001';
    END IF;
    -- [F5] insumos do card novo/vazio (Duplicar) aceitam Planejamento; card ja com ficha segue exigindo Desenvolvimento.
    IF v_bom_inicial THEN
      PERFORM public._seg_exige_pagina('criacao_desenvolvimento', 'criacao_planejamento');
    ELSE
      PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
    END IF;
  END IF;
  IF _cad IS NOT NULL THEN
    IF jsonb_typeof(_cad) <> 'object'
       OR jsonb_typeof(_cad->'tecidos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_cad->'grades') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_cad->'aviamentos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_cad->'etiquetas') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'cad_invalido: esperado tecidos, grades, aviamentos e etiquetas (listas)' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  END IF;
  IF _mo IS NOT NULL THEN
    IF jsonb_typeof(_mo) <> 'array' THEN
      RAISE EXCEPTION 'mo_invalida: esperado uma lista' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (public.user_can_edit('criacao_planejamento') AND public._pode_ver_custos()) THEN
      RAISE EXCEPTION 'mao_obra_sem_permissao: editar criacao_planejamento e ver custos' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _grade_revenda IS NOT NULL THEN
    IF jsonb_typeof(_grade_revenda) <> 'array' THEN
      RAISE EXCEPTION 'grade_invalida: esperado uma lista' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public.tenant_module_enabled('produto_acabado') THEN
      RAISE EXCEPTION 'Módulo Produto Acabado (Revenda) não habilitado para esta loja' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _revisao IS NOT NULL AND jsonb_typeof(_revisao) <> 'object' THEN
    RAISE EXCEPTION 'revisao_invalida: esperado um objeto' USING ERRCODE = 'P0001';
  END IF;

  -- Cabecalho: so colunas da lista fechada.
  IF _header IS NOT NULL THEN
    SELECT string_agg(k, ',' ORDER BY k) INTO v_ruins
      FROM jsonb_object_keys(_header) AS k
     WHERE k <> ALL (c_header_ok);
    IF v_ruins IS NOT NULL THEN
      RAISE EXCEPTION 'header_campo_invalido: %', v_ruins USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2. travas na ORDEM UNICA (card -> CAD -> linha de modelos) e trava otimista. A posse do card ja foi conferida no passo 1
  --    (antes de qualquer leitura de BOM), entao nao se toma trava de id alheio.
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));
  PERFORM pg_advisory_xact_lock(hashtext(c.id::text)) FROM public.cad c WHERE c.modelo_id = _modelo_id ORDER BY c.id;

  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id = _modelo_id FOR UPDATE;
  IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
    RAISE EXCEPTION 'conflito_versao: card' USING ERRCODE = 'P0409';
  END IF;

  -- 3. cabecalho (so as chaves presentes; o merge/omissao por permissao e decidido pela tela, como antes).
  IF _header IS NOT NULL AND _header <> '{}'::jsonb THEN
    SELECT string_agg(format('%1$I = r.%1$I', k), ', ') INTO v_sets FROM jsonb_object_keys(_header) AS k;
    EXECUTE format(
      'UPDATE public.modelos m SET %s FROM jsonb_populate_record(NULL::public.modelos, $1) r WHERE m.id = $2', v_sets)
      USING _header, _modelo_id;
  END IF;

  -- 4. BOM (rev ja conferido acima: _rev_base => NULL no _core)
  IF _bom IS NOT NULL THEN
    PERFORM public._salvar_modelo_bom_core(_modelo_id, _bom->'tecidos', _bom->'aviamentos', _bom->'grades', NULL);
  END IF;

  -- 5. insumos/etiquetas (diff do estado completo)
  IF _etiquetas IS NOT NULL THEN
    PERFORM public._salvar_etiquetas_modelo_core(_modelo_id, _etiquetas);
  END IF;

  -- 6. CAD (proporcoes ausentes = mantem as do card, nunca zera)
  IF _cad IS NOT NULL THEN
    IF jsonb_typeof(_cad->'proporcoes') = 'object' THEN
      v_proporcoes := _cad->'proporcoes';
    ELSE
      SELECT COALESCE(m.proporcoes, '{}'::jsonb) INTO v_proporcoes FROM public.modelos m WHERE m.id = _modelo_id;
    END IF;
    PERFORM public._salvar_cad_completo_core(
      _modelo_id, _cad->'tecidos', _cad->'grades', _cad->'aviamentos', _cad->'etiquetas', v_proporcoes,
      _cad->>'observacoes_molde', NULLIF(_cad->>'data_previsao_corte', '')::date);
  END IF;

  -- 7. mao de obra por servico (estado completo)
  IF _mo IS NOT NULL THEN
    PERFORM public._salvar_modelo_servico_mo_core(_modelo_id, _mo);
  END IF;

  -- 8. grade da revenda
  IF _grade_revenda IS NOT NULL THEN
    PERFORM public._salvar_grade_revenda_core(_modelo_id, _grade_revenda, NULL);
  END IF;

  -- 9. #Erro nas etapas seguintes (so o que o BOM gravado mudou)
  IF _revisao IS NOT NULL THEN
    v_marcadas := public.marcar_revisao_por_mudanca(
      _modelo_id,
      COALESCE((_revisao->>'grade')::boolean, false),
      COALESCE((_revisao->>'consumo')::boolean, false),
      COALESCE((_revisao->>'aviamentos')::boolean, false));
  END IF;

  -- 10. rev atual (o processador adiado do custo pode somar 1 no COMMIT: a tela releia se precisar do rev final)
  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id = _modelo_id;
  RETURN jsonb_build_object('modelo_id', _modelo_id, 'rev', v_rev, 'revisao_marcada', COALESCE(v_marcadas, '{}'::jsonb));
END
$function$;

COMMIT;
