-- Importação em massa — PRODUTO (Fase 4): revenda (produto acabado) + importado.
-- Aba única com coluna `tipo` (revenda|importado); os dois são gêmeos estruturais (mesmo núcleo
-- de identidade/fornecedor/grade/variantes), só o bloco de preço difere (BRL vs câmbio).
--
-- Padrão das outras 3 RPCs de import (tecido/aviamento/insumo): SECURITY DEFINER, valida auth+
-- tenant+módulo, IDOR de TODAS as FKs (EXISTS tenant-scoped), upsert por NOME normalizado
-- (_import_nome_norm), REVOKE dos 3 (invariante #9). Diferenças próprias do produto:
--  • ramifica por `_tipo` → produtos_acabados OU produtos_importados (+ suas variantes).
--  • COMPLEMENTAR atualiza o cabeçalho com COALESCE (não zera vazio; decisão do dono set/2026)
--    e adiciona variantes que faltam por (cor,apelido).
--  • CRIA O CARD-espelho em modelos (origem revenda/importado) via _criar_card_*_core — só se o
--    produto ainda não tem (idempotente). É o que faz o produto aparecer no Planejamento.
--  • Etapas de landed cost (importado, 1:N) ficam FORA da importação (produto nasce sem cadeia;
--    o usuário completa no card) — decisão do dono.
--  • Grade: `grade_proporcao` jsonb {tamanho:peso} vem pronta do cliente; a grade real por
--    variante é derivada na criação do card (_pa_grade_variante: acessório→{UN:qtd}).

CREATE OR REPLACE FUNCTION public.importar_produto_linha(_cabecalho jsonb, _variantes jsonb, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_modelo_id uuid;
  v_nome text;
  v_grupo uuid;
  v_categoria uuid;
  v_sub1 uuid;
  v_sub2 uuid;
  v_empresa uuid;
  v_rep uuid;
  v_colecao uuid;
  v_existe_id uuid;
  v_existe_modelo uuid;
  r jsonb;
  v_cor uuid;
  v_apelido uuid;
  v_var_id uuid;
  v_max_ordem int;
  v_acao text := 'inalterado';
  v_novas int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;

  IF _tipo NOT IN ('revenda', 'importado') THEN
    RAISE EXCEPTION 'Tipo de produto inválido: % (use revenda ou importado).', _tipo USING errcode = 'P0001';
  END IF;
  -- módulo por tipo (mesmo gate das telas)
  IF _tipo = 'revenda' AND NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING errcode = '42501';
  END IF;
  IF _tipo = 'importado' AND NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não está ativo para esta loja.' USING errcode = '42501';
  END IF;

  v_nome := NULLIF(btrim(_cabecalho->>'nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do produto.' USING errcode = 'P0001'; END IF;

  v_grupo     := NULLIF(_cabecalho->>'grupo_id','')::uuid;
  v_categoria := NULLIF(_cabecalho->>'categoria_id','')::uuid;
  v_sub1      := NULLIF(_cabecalho->>'subcategoria1_id','')::uuid;
  v_sub2      := NULLIF(_cabecalho->>'subcategoria2_id','')::uuid;
  v_empresa   := NULLIF(_cabecalho->>'empresa_id','')::uuid;
  v_rep       := NULLIF(_cabecalho->>'representante_id','')::uuid;
  v_colecao   := NULLIF(_cabecalho->>'colecao_id','')::uuid;

  -- grupo/categoria são obrigatórios na CRIAÇÃO (as RPCs de save exigem).
  IF v_grupo IS NULL OR v_categoria IS NULL THEN
    RAISE EXCEPTION 'Informe grupo e categoria do produto.' USING errcode = 'P0001';
  END IF;

  -- IDOR: cada FK do cabeçalho tem de ser da MESMA loja (fecha payload forjado).
  IF NOT EXISTS (SELECT 1 FROM grupos_produto g WHERE g.id = v_grupo AND g.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Grupo não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM categorias_produto c WHERE c.id = v_categoria AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Categoria não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias1_produto s WHERE s.id = v_sub1 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 1 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias2_produto s WHERE s.id = v_sub2 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 2 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_empresa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = v_empresa AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fornecedor não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_rep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM representantes rp WHERE rp.id = v_rep AND rp.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Representante não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_colecao IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colecoes cc WHERE cc.id = v_colecao AND cc.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- cores das variantes têm de ser da loja.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
    WHERE NULLIF(e->>'cor_id','') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.id = (e->>'cor_id')::uuid AND c.tenant_id = v_tenant)
  ) THEN
    RAISE EXCEPTION 'Cor base não pertence à loja.' USING errcode = 'P0001';
  END IF;
  -- apelido (se informado) tem de pertencer à cor base escolhida E à loja.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
    JOIN cores_apelido ca ON ca.id = (e->>'cor_apelido_id')::uuid
    WHERE NULLIF(e->>'cor_apelido_id','') IS NOT NULL
      AND (ca.tenant_id IS DISTINCT FROM v_tenant
           OR ca.cor_base_id IS DISTINCT FROM (e->>'cor_id')::uuid)
  ) THEN
    RAISE EXCEPTION 'Cor apelido não pertence à cor base informada (ou à loja).' USING errcode = 'P0001';
  END IF;

  -- =========================================================================
  -- Resolve o ALVO do upsert por NOME normalizado (produto acabado/importado NÃO têm unique de
  -- nome; a busca é a rede contra duplicar ao reimportar). NULL = criar.
  -- =========================================================================
  IF _tipo = 'revenda' THEN
    SELECT id, modelo_id INTO v_existe_id, v_existe_modelo FROM produtos_acabados
      WHERE tenant_id = v_tenant AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
      ORDER BY created_at LIMIT 1;
  ELSE
    SELECT id, modelo_id INTO v_existe_id, v_existe_modelo FROM produtos_importados
      WHERE tenant_id = v_tenant AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
      ORDER BY created_at LIMIT 1;
  END IF;

  -- =========================================================================
  -- CRIAR (produto novo)
  -- =========================================================================
  IF v_existe_id IS NULL THEN
    IF _tipo = 'revenda' THEN
      INSERT INTO produtos_acabados (
        tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
        grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total,
        markup_atacado, markup_varejo, foto_url
      ) VALUES (
        v_tenant, v_nome, NULLIF(_cabecalho->>'ref',''), v_grupo, v_categoria, v_sub1, v_sub2,
        v_colecao, NULLIF(_cabecalho->>'subcolecao',''), NULLIF(_cabecalho->>'semana',''),
        v_empresa, v_rep, NULLIF(_cabecalho->>'ref_fornecedor',''), NULLIF(_cabecalho->>'composicao',''),
        COALESCE(_cabecalho->'grade_proporcao','{}'::jsonb),
        COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, 0),
        COALESCE(NULLIF(_cabecalho->>'valor_unitario','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, 0),
        0,
        NULLIF(_cabecalho->>'markup_atacado','')::numeric,
        NULLIF(_cabecalho->>'markup_varejo','')::numeric,
        NULLIF(_cabecalho->>'foto_url','')
      ) RETURNING id INTO v_id;
    ELSE
      INSERT INTO produtos_importados (
        tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
        grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
        moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
        desconto_pct, cotacao_final, markup_atacado, markup_varejo
      ) VALUES (
        v_tenant, v_nome, NULLIF(_cabecalho->>'ref',''), v_grupo, v_categoria, v_sub1, v_sub2,
        v_colecao, NULLIF(_cabecalho->>'subcolecao',''), NULLIF(_cabecalho->>'semana',''),
        v_empresa, v_rep, NULLIF(_cabecalho->>'ref_fornecedor',''), NULLIF(_cabecalho->>'composicao',''),
        COALESCE(_cabecalho->'grade_proporcao','{}'::jsonb),
        COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, 0),
        NULLIF(_cabecalho->>'foto_url',''),
        NULLIF(_cabecalho->>'data_pedido','')::date, NULLIF(_cabecalho->>'data_prevista','')::date, NULLIF(_cabecalho->>'data_entrega','')::date,
        COALESCE(NULLIF(_cabecalho->>'moeda_compra',''),'RMB'), NULLIF(_cabecalho->>'moeda_intermediaria',''),
        COALESCE(NULLIF(_cabecalho->>'valor_unitario_m1','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'cotacao_ref','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'peso_kg','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'transporte_m2','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, 0),
        COALESCE(NULLIF(_cabecalho->>'cotacao_final','')::numeric, 0),
        NULLIF(_cabecalho->>'markup_atacado','')::numeric,
        NULLIF(_cabecalho->>'markup_varejo','')::numeric
      ) RETURNING id INTO v_id;
    END IF;
    v_acao := 'criado';
  ELSE
    -- =======================================================================
    -- COMPLEMENTAR (produto já existe) — atualiza cabeçalho com COALESCE (não zera vazio).
    -- =======================================================================
    v_id := v_existe_id;
    IF _tipo = 'revenda' THEN
      UPDATE produtos_acabados SET
        grupo_id         = COALESCE(v_grupo, grupo_id),
        categoria_id     = COALESCE(v_categoria, categoria_id),
        subcategoria1_id = COALESCE(v_sub1, subcategoria1_id),
        subcategoria2_id = COALESCE(v_sub2, subcategoria2_id),
        colecao_id       = COALESCE(v_colecao, colecao_id),
        subcolecao       = COALESCE(NULLIF(_cabecalho->>'subcolecao',''), subcolecao),
        semana           = COALESCE(NULLIF(_cabecalho->>'semana',''), semana),
        empresa_id       = COALESCE(v_empresa, empresa_id),
        representante_id = COALESCE(v_rep, representante_id),
        ref_fornecedor   = COALESCE(NULLIF(_cabecalho->>'ref_fornecedor',''), ref_fornecedor),
        composicao       = COALESCE(NULLIF(_cabecalho->>'composicao',''), composicao),
        grade_proporcao  = CASE WHEN _cabecalho ? 'grade_proporcao' AND _cabecalho->'grade_proporcao' <> '{}'::jsonb
                                THEN _cabecalho->'grade_proporcao' ELSE grade_proporcao END,
        qtd_total        = COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, qtd_total),
        valor_unitario   = COALESCE(NULLIF(_cabecalho->>'valor_unitario','')::numeric, valor_unitario),
        desconto_pct     = COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, desconto_pct),
        markup_atacado   = COALESCE(NULLIF(_cabecalho->>'markup_atacado','')::numeric, markup_atacado),
        markup_varejo    = COALESCE(NULLIF(_cabecalho->>'markup_varejo','')::numeric, markup_varejo),
        foto_url         = COALESCE(NULLIF(_cabecalho->>'foto_url',''), foto_url),
        updated_at       = now()
      WHERE id = v_id AND tenant_id = v_tenant;
    ELSE
      UPDATE produtos_importados SET
        grupo_id            = COALESCE(v_grupo, grupo_id),
        categoria_id        = COALESCE(v_categoria, categoria_id),
        subcategoria1_id    = COALESCE(v_sub1, subcategoria1_id),
        subcategoria2_id    = COALESCE(v_sub2, subcategoria2_id),
        colecao_id          = COALESCE(v_colecao, colecao_id),
        subcolecao          = COALESCE(NULLIF(_cabecalho->>'subcolecao',''), subcolecao),
        semana              = COALESCE(NULLIF(_cabecalho->>'semana',''), semana),
        empresa_id          = COALESCE(v_empresa, empresa_id),
        representante_id    = COALESCE(v_rep, representante_id),
        ref_fornecedor      = COALESCE(NULLIF(_cabecalho->>'ref_fornecedor',''), ref_fornecedor),
        composicao          = COALESCE(NULLIF(_cabecalho->>'composicao',''), composicao),
        grade_proporcao     = CASE WHEN _cabecalho ? 'grade_proporcao' AND _cabecalho->'grade_proporcao' <> '{}'::jsonb
                                   THEN _cabecalho->'grade_proporcao' ELSE grade_proporcao END,
        qtd_total           = COALESCE(NULLIF(_cabecalho->>'qtd_total','')::int, qtd_total),
        foto_url            = COALESCE(NULLIF(_cabecalho->>'foto_url',''), foto_url),
        data_pedido         = COALESCE(NULLIF(_cabecalho->>'data_pedido','')::date, data_pedido),
        data_prevista       = COALESCE(NULLIF(_cabecalho->>'data_prevista','')::date, data_prevista),
        data_entrega        = COALESCE(NULLIF(_cabecalho->>'data_entrega','')::date, data_entrega),
        moeda_compra        = COALESCE(NULLIF(_cabecalho->>'moeda_compra',''), moeda_compra),
        moeda_intermediaria = COALESCE(NULLIF(_cabecalho->>'moeda_intermediaria',''), moeda_intermediaria),
        valor_unitario_m1   = COALESCE(NULLIF(_cabecalho->>'valor_unitario_m1','')::numeric, valor_unitario_m1),
        cotacao_ref         = COALESCE(NULLIF(_cabecalho->>'cotacao_ref','')::numeric, cotacao_ref),
        peso_kg             = COALESCE(NULLIF(_cabecalho->>'peso_kg','')::numeric, peso_kg),
        transporte_m2       = COALESCE(NULLIF(_cabecalho->>'transporte_m2','')::numeric, transporte_m2),
        desconto_pct        = COALESCE(NULLIF(_cabecalho->>'desconto_pct','')::numeric, desconto_pct),
        cotacao_final       = COALESCE(NULLIF(_cabecalho->>'cotacao_final','')::numeric, cotacao_final),
        markup_atacado      = COALESCE(NULLIF(_cabecalho->>'markup_atacado','')::numeric, markup_atacado),
        markup_varejo       = COALESCE(NULLIF(_cabecalho->>'markup_varejo','')::numeric, markup_varejo),
        updated_at          = now()
      WHERE id = v_id AND tenant_id = v_tenant;
    END IF;
  END IF;

  -- =========================================================================
  -- Variantes: adiciona por (cor, apelido) as que faltam (não recria o que já existe).
  -- Ordem nova = max(ordem) + 1 (respeita UNIQUE(produto, ordem)).
  -- =========================================================================
  IF _tipo = 'revenda' THEN
    SELECT COALESCE(MAX(ordem), -1) INTO v_max_ordem FROM produto_acabado_variantes WHERE produto_acabado_id = v_id;
  ELSE
    SELECT COALESCE(MAX(ordem), -1) INTO v_max_ordem FROM produto_importado_variantes WHERE produto_importado_id = v_id;
  END IF;

  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
           WHERE NULLIF(e->>'cor_id','') IS NOT NULL
  LOOP
    v_cor := (r->>'cor_id')::uuid;
    v_apelido := NULLIF(r->>'cor_apelido_id','')::uuid;

    IF _tipo = 'revenda' THEN
      SELECT id INTO v_var_id FROM produto_acabado_variantes
        WHERE produto_acabado_id = v_id AND cor_id = v_cor AND cor_apelido_id IS NOT DISTINCT FROM v_apelido
        LIMIT 1;
    ELSE
      SELECT id INTO v_var_id FROM produto_importado_variantes
        WHERE produto_importado_id = v_id AND cor_id = v_cor AND cor_apelido_id IS NOT DISTINCT FROM v_apelido
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      v_max_ordem := v_max_ordem + 1;
      IF _tipo = 'revenda' THEN
        INSERT INTO produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
        VALUES (v_tenant, v_id, v_max_ordem, v_cor, v_apelido,
                COALESCE(NULLIF(r->>'peso','')::numeric, 0), COALESCE(NULLIF(r->>'qtd','')::int, 0));
      ELSE
        INSERT INTO produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
        VALUES (v_tenant, v_id, v_max_ordem, v_cor, v_apelido,
                COALESCE(NULLIF(r->>'peso','')::numeric, 0), COALESCE(NULLIF(r->>'qtd','')::int, 0));
      END IF;
      v_novas := v_novas + 1;
    END IF;
  END LOOP;

  -- =========================================================================
  -- Card-espelho em modelos (o que faz o produto aparecer no Planejamento). Só cria se ainda
  -- não existe — os _core são idempotentes (RAISE se já tem card), então guardamos aqui.
  -- =========================================================================
  IF _tipo = 'revenda' THEN
    SELECT modelo_id INTO v_existe_modelo FROM produtos_acabados WHERE id = v_id;
    IF v_existe_modelo IS NULL THEN
      v_modelo_id := public._criar_card_produto_acabado_core(v_id);
    ELSE
      v_modelo_id := v_existe_modelo;
    END IF;
  ELSE
    SELECT modelo_id INTO v_existe_modelo FROM produtos_importados WHERE id = v_id;
    IF v_existe_modelo IS NULL THEN
      v_modelo_id := public._criar_card_produto_importado_core(v_id);
    ELSE
      v_modelo_id := v_existe_modelo;
    END IF;
  END IF;

  -- ação final p/ o relatório
  IF v_acao <> 'criado' THEN
    v_acao := CASE WHEN v_novas > 0 THEN 'complementado' ELSE 'inalterado' END;
  END IF;

  RETURN jsonb_build_object('produto_id', v_id, 'modelo_id', v_modelo_id, 'acao', v_acao, 'variantes_novas', v_novas);
END $function$;

-- Invariante #9: EXECUTE só p/ authenticated (o CREATE OR REPLACE reabre p/ PUBLIC por default).
REVOKE EXECUTE ON FUNCTION public.importar_produto_linha(jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_produto_linha(jsonb, jsonb, text) TO authenticated;
