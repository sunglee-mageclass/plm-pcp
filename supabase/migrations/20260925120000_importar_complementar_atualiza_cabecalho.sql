-- Importação em massa: no ramo COMPLEMENTAR (item já existe), ATUALIZAR os campos de
-- cabeçalho que vierem PREENCHIDOS na planilha, sem zerar o que já está no banco.
--
-- Antes: o ramo COMPLEMENTAR das 3 RPCs (tecido/aviamento/insumo) descartava o cabeçalho
-- inteiro — só completava foto. Efeito: reimportar um tecido em kg não trazia `rendimento`;
-- reimportar um aviamento não trazia o `preco` de referência (só o preço da variante); etc.
-- Decisão do dono (set/2026): "atualizar se veio preenchido" → UPDATE com
-- COALESCE(NULLIF(novo,''), atual) por campo. Célula vazia na planilha NÃO zera o banco.
--
-- Só o ramo COMPLEMENTAR muda; CRIAR, IDOR, variantes e o retorno são idênticos ao vivo
-- (diff-validado antes/depois com pg_get_functiondef). REVOKE já vigente (invariante #9) intacto.

-- =====================================================================================
-- TECIDO
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.importar_tecido_linha(_cabecalho jsonb, _variantes jsonb, _categoria_ids uuid[], _artigo_alvo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_artigo_id uuid;
  v_nome text;
  v_empresa uuid;
  v_rep uuid;
  v_mes uuid;
  v_ano uuid;
  r jsonb;
  v_cor uuid;
  v_apelido uuid;
  v_existe_id uuid;
  v_var_id uuid;
  v_var_foto text;
  v_novo boolean;
  v_acao text := 'inalterado';
  v_novas int := 0;
  v_fotos int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;

  v_nome := NULLIF(btrim(_cabecalho->>'nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do tecido.' USING errcode = 'P0001'; END IF;

  v_empresa := NULLIF(_cabecalho->>'empresa_id','')::uuid;
  v_rep     := NULLIF(_cabecalho->>'representante_id','')::uuid;
  v_mes     := NULLIF(_cabecalho->>'mes_id','')::uuid;
  v_ano     := NULLIF(_cabecalho->>'ano_id','')::uuid;

  -- IDOR: cada FK do cabeçalho tem de ser da MESMA loja (fecha payload forjado).
  IF v_empresa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = v_empresa AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fornecedor não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_rep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM representantes rp WHERE rp.id = v_rep AND rp.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Representante não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_mes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meses m WHERE m.id = v_mes AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Mês não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_ano IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anos a WHERE a.id = v_ano AND a.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Ano não pertence à loja.' USING errcode = 'P0001';
  END IF;

  IF _categoria_ids IS NOT NULL AND array_length(_categoria_ids, 1) IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM unnest(_categoria_ids) cid
      WHERE NOT EXISTS (SELECT 1 FROM categorias_tecido ct WHERE ct.id = cid AND ct.tenant_id = v_tenant)
    ) THEN
      RAISE EXCEPTION 'Categoria de tecido não pertence à loja.' USING errcode = 'P0001';
    END IF;
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
  -- Resolve o ALVO do upsert.
  --  • _artigo_alvo_id explícito (o front confirmou "é o mesmo tecido X"): usa ele (valida tenant).
  --  • senão, busca por NOME normalizado + MESMO fornecedor (empresa). NULL bate NULL.
  -- =========================================================================
  IF _artigo_alvo_id IS NOT NULL THEN
    SELECT id INTO v_existe_id FROM artigos
      WHERE id = _artigo_alvo_id AND tenant_id = v_tenant;
    IF v_existe_id IS NULL THEN
      RAISE EXCEPTION 'Tecido alvo não encontrado na loja.' USING errcode = 'P0001';
    END IF;
  ELSE
    -- nome normalizado tolerante (acento/caixa/espaços), preservando números; mesmo fornecedor.
    SELECT id INTO v_existe_id FROM artigos
      WHERE tenant_id = v_tenant
        AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
        AND empresa_id IS NOT DISTINCT FROM v_empresa           -- mesmo fornecedor (NULL=NULL)
      ORDER BY created_at
      LIMIT 1;
  END IF;

  IF v_existe_id IS NULL THEN
    -- ---------- CRIAR (tecido novo) ----------
    INSERT INTO artigos (nome, unidade_medida, ncm, empresa_id, representante_id,
                         composicao, rendimento, preco, mes_id, ano_id)
    VALUES (
      v_nome,
      COALESCE(NULLIF(_cabecalho->>'unidade_medida',''), 'metro'),
      NULLIF(_cabecalho->>'ncm',''),
      v_empresa, v_rep,
      NULLIF(_cabecalho->>'composicao',''),
      NULLIF(_cabecalho->>'rendimento','')::numeric,
      NULLIF(_cabecalho->>'preco','')::numeric,
      v_mes, v_ano
    )
    RETURNING id INTO v_artigo_id;

    IF _categoria_ids IS NOT NULL AND array_length(_categoria_ids, 1) IS NOT NULL THEN
      PERFORM public.set_artigo_categorias(v_artigo_id, _categoria_ids);
    END IF;
    v_acao := 'criado';
  ELSE
    -- ---------- COMPLEMENTAR (tecido existente) ----------
    -- Atualiza os campos de cabeçalho que vierem PREENCHIDOS na planilha (não zera o que já
    -- existe — COALESCE(novo, atual)). Categorias e FKs só entram se informadas.
    v_artigo_id := v_existe_id;
    UPDATE artigos SET
      unidade_medida  = COALESCE(NULLIF(_cabecalho->>'unidade_medida',''), unidade_medida),
      ncm             = COALESCE(NULLIF(_cabecalho->>'ncm',''), ncm),
      empresa_id      = COALESCE(v_empresa, empresa_id),
      representante_id= COALESCE(v_rep, representante_id),
      composicao      = COALESCE(NULLIF(_cabecalho->>'composicao',''), composicao),
      rendimento      = COALESCE(NULLIF(_cabecalho->>'rendimento','')::numeric, rendimento),
      preco           = COALESCE(NULLIF(_cabecalho->>'preco','')::numeric, preco),
      mes_id          = COALESCE(v_mes, mes_id),
      ano_id          = COALESCE(v_ano, ano_id)
    WHERE id = v_artigo_id AND tenant_id = v_tenant;

    IF _categoria_ids IS NOT NULL AND array_length(_categoria_ids, 1) IS NOT NULL THEN
      PERFORM public.set_artigo_categorias(v_artigo_id, _categoria_ids);
    END IF;
  END IF;

  -- variantes: por cor+apelido, insere se falta; completa foto se vazia (nunca sobrescreve).
  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
           WHERE NULLIF(e->>'cor_id','') IS NOT NULL
  LOOP
    v_cor := (r->>'cor_id')::uuid;
    v_apelido := NULLIF(r->>'cor_apelido_id','')::uuid;
    v_var_foto := NULLIF(r->>'foto_url','');

    SELECT id, foto_url INTO v_var_id, v_var_foto
      FROM variantes_tecido
      WHERE artigo_id = v_artigo_id AND tenant_id = v_tenant
        AND cor_id = v_cor
        AND cor_apelido_id IS NOT DISTINCT FROM v_apelido
      LIMIT 1;

    IF NOT FOUND THEN
      -- variante nova → insere
      INSERT INTO variantes_tecido
        (artigo_id, cor_id, cor_apelido_id, nome_variante, codigo_variante, preco, foto_url)
      VALUES (
        v_artigo_id, v_cor, v_apelido,
        NULLIF(r->>'nome_variante',''),
        NULLIF(r->>'codigo_variante',''),
        NULLIF(r->>'preco','')::numeric,
        NULLIF(r->>'foto_url','')
      );
      v_novas := v_novas + 1;
    ELSE
      -- variante existe → completa SÓ a foto se estiver vazia e veio foto nova (não sobrescreve).
      IF (v_var_foto IS NULL OR v_var_foto = '') AND NULLIF(r->>'foto_url','') IS NOT NULL THEN
        UPDATE variantes_tecido SET foto_url = NULLIF(r->>'foto_url','')
          WHERE id = v_var_id AND tenant_id = v_tenant;
        v_fotos := v_fotos + 1;
      END IF;
    END IF;
  END LOOP;

  -- ação final p/ o relatório
  IF v_acao <> 'criado' THEN
    IF v_novas > 0 THEN v_acao := 'complementado';
    ELSIF v_fotos > 0 THEN v_acao := 'so_foto';
    ELSE v_acao := 'inalterado';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'artigo_id', v_artigo_id,
    'acao', v_acao,
    'variantes_novas', v_novas,
    'fotos_completadas', v_fotos
  );
END $function$;

-- =====================================================================================
-- AVIAMENTO
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.importar_aviamento_linha(_cabecalho jsonb, _variantes jsonb, _aviamento_alvo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_empresa uuid;
  v_rep uuid;
  v_cat uuid;
  v_subcat uuid;
  v_material uuid;
  v_intervalo uuid;
  v_existe_id uuid;
  v_foto_atual text;
  v_foto_nova text;
  r jsonb;
  v_cor uuid;
  v_apelido uuid;
  v_var_id uuid;
  v_var_foto text;
  v_acao text := 'inalterado';
  v_novas int := 0;
  v_fotos int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;

  v_nome := NULLIF(btrim(_cabecalho->>'codigo_nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do aviamento.' USING errcode = 'P0001'; END IF;

  v_empresa  := NULLIF(_cabecalho->>'empresa_id','')::uuid;
  v_rep      := NULLIF(_cabecalho->>'representante_id','')::uuid;
  v_cat      := NULLIF(_cabecalho->>'categoria_aviamento_id','')::uuid;
  v_subcat   := NULLIF(_cabecalho->>'subcategoria_aviamento_id','')::uuid;
  v_material := NULLIF(_cabecalho->>'material_aviamento_id','')::uuid;
  v_intervalo := NULLIF(_cabecalho->>'intervalo_largura_id','')::uuid;
  v_foto_nova := NULLIF(_cabecalho->>'foto_url','');

  -- IDOR: cada FK do cabeçalho tem de ser da MESMA loja.
  IF v_empresa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = v_empresa AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fornecedor não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_rep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM representantes rp WHERE rp.id = v_rep AND rp.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Representante não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_cat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categorias_aviamento c WHERE c.id = v_cat AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Categoria de aviamento não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_subcat IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias_aviamento s WHERE s.id = v_subcat AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_material IS NOT NULL AND NOT EXISTS (SELECT 1 FROM materiais_aviamento m WHERE m.id = v_material AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Material não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_intervalo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM intervalos_largura il WHERE il.id = v_intervalo AND il.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Intervalo de largura não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- cores/apelidos das variantes (mesma validação do tecido)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
    WHERE NULLIF(e->>'cor_id','') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.id = (e->>'cor_id')::uuid AND c.tenant_id = v_tenant)
  ) THEN
    RAISE EXCEPTION 'Cor base não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
    JOIN cores_apelido ca ON ca.id = (e->>'cor_apelido_id')::uuid
    WHERE NULLIF(e->>'cor_apelido_id','') IS NOT NULL
      AND (ca.tenant_id IS DISTINCT FROM v_tenant OR ca.cor_base_id IS DISTINCT FROM (e->>'cor_id')::uuid)
  ) THEN
    RAISE EXCEPTION 'Cor apelido não pertence à cor base informada (ou à loja).' USING errcode = 'P0001';
  END IF;

  -- Resolve o ALVO do upsert (alvo explícito OU nome normalizado + mesmo fornecedor).
  IF _aviamento_alvo_id IS NOT NULL THEN
    SELECT id INTO v_existe_id FROM aviamentos WHERE id = _aviamento_alvo_id AND tenant_id = v_tenant;
    IF v_existe_id IS NULL THEN RAISE EXCEPTION 'Aviamento alvo não encontrado na loja.' USING errcode = 'P0001'; END IF;
  ELSE
    SELECT id INTO v_existe_id FROM aviamentos
      WHERE tenant_id = v_tenant
        AND public._import_nome_norm(codigo_nome) = public._import_nome_norm(v_nome)
        AND empresa_id IS NOT DISTINCT FROM v_empresa
      ORDER BY created_at LIMIT 1;
  END IF;

  IF v_existe_id IS NULL THEN
    -- CRIAR (código gerado pelo trigger — não passar `codigo`; tenant_id pelo trigger set_tenant_id)
    INSERT INTO aviamentos (codigo_nome, empresa_id, representante_id, categoria_aviamento_id,
                            subcategoria_aviamento_id, material_aviamento_id, composicao, preco,
                            ncm, intervalo_largura_id, largura_exata, observacoes, foto_url)
    VALUES (
      v_nome, v_empresa, v_rep, v_cat, v_subcat, v_material,
      NULLIF(_cabecalho->>'composicao',''),
      NULLIF(_cabecalho->>'preco','')::numeric,
      NULLIF(_cabecalho->>'ncm',''),
      v_intervalo,
      NULLIF(_cabecalho->>'largura_exata','')::numeric,
      NULLIF(_cabecalho->>'observacoes',''),
      v_foto_nova
    )
    RETURNING id INTO v_id;
    v_acao := 'criado';
  ELSE
    -- COMPLEMENTAR: atualiza os campos de cabeçalho que vierem PREENCHIDOS (COALESCE não zera),
    -- inclusive `preco` de referência do aviamento; completa a foto só se estiver vazia.
    v_id := v_existe_id;
    SELECT foto_url INTO v_foto_atual FROM aviamentos WHERE id = v_id AND tenant_id = v_tenant;
    UPDATE aviamentos SET
      empresa_id                = COALESCE(v_empresa, empresa_id),
      representante_id          = COALESCE(v_rep, representante_id),
      categoria_aviamento_id    = COALESCE(v_cat, categoria_aviamento_id),
      subcategoria_aviamento_id = COALESCE(v_subcat, subcategoria_aviamento_id),
      material_aviamento_id     = COALESCE(v_material, material_aviamento_id),
      composicao                = COALESCE(NULLIF(_cabecalho->>'composicao',''), composicao),
      preco                     = COALESCE(NULLIF(_cabecalho->>'preco','')::numeric, preco),
      ncm                       = COALESCE(NULLIF(_cabecalho->>'ncm',''), ncm),
      intervalo_largura_id      = COALESCE(v_intervalo, intervalo_largura_id),
      largura_exata             = COALESCE(NULLIF(_cabecalho->>'largura_exata','')::numeric, largura_exata),
      observacoes               = COALESCE(NULLIF(_cabecalho->>'observacoes',''), observacoes),
      -- foto: só completa se estava vazia (mesma política de "não sobrescrever" do fluxo antigo)
      foto_url                  = CASE WHEN (v_foto_atual IS NULL OR v_foto_atual = '') AND v_foto_nova IS NOT NULL
                                       THEN v_foto_nova ELSE foto_url END
    WHERE id = v_id AND tenant_id = v_tenant;
    IF (v_foto_atual IS NULL OR v_foto_atual = '') AND v_foto_nova IS NOT NULL THEN
      v_fotos := v_fotos + 1;
    END IF;
  END IF;

  -- variantes: por cor+apelido, insere se falta (variante de aviamento NÃO tem foto).
  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
           WHERE NULLIF(e->>'cor_id','') IS NOT NULL
  LOOP
    v_cor := (r->>'cor_id')::uuid;
    v_apelido := NULLIF(r->>'cor_apelido_id','')::uuid;
    SELECT id INTO v_var_id FROM variantes_aviamento
      WHERE aviamento_id = v_id AND tenant_id = v_tenant
        AND cor_id = v_cor AND cor_apelido_id IS NOT DISTINCT FROM v_apelido
      LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO variantes_aviamento (aviamento_id, cor_id, cor_apelido_id, nome_variante, codigo_variante, preco)
      VALUES (v_id, v_cor, v_apelido, NULLIF(r->>'nome_variante',''), NULLIF(r->>'codigo_variante',''), NULLIF(r->>'preco','')::numeric);
      v_novas := v_novas + 1;
    END IF;
  END LOOP;

  IF v_acao <> 'criado' THEN
    IF v_novas > 0 THEN v_acao := 'complementado';
    ELSIF v_fotos > 0 THEN v_acao := 'so_foto';
    ELSE v_acao := 'inalterado';
    END IF;
  END IF;

  RETURN jsonb_build_object('aviamento_id', v_id, 'acao', v_acao, 'variantes_novas', v_novas, 'fotos_completadas', v_fotos);
END $function$;

-- =====================================================================================
-- INSUMO
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.importar_insumo_linha(_cabecalho jsonb, _variantes jsonb, _etiqueta_alvo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_empresa uuid;
  v_rep uuid;
  v_tipo uuid;
  v_existe_id uuid;
  r jsonb;
  v_cor uuid;
  v_tam text;
  v_var_id uuid;
  v_acao text := 'inalterado';
  v_novas int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;

  v_nome := NULLIF(btrim(_cabecalho->>'nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do insumo.' USING errcode = 'P0001'; END IF;

  v_empresa := NULLIF(_cabecalho->>'empresa_id','')::uuid;
  v_rep     := NULLIF(_cabecalho->>'representante_id','')::uuid;
  v_tipo    := NULLIF(_cabecalho->>'tipo_insumo_id','')::uuid;

  -- IDOR: FKs do cabeçalho da MESMA loja.
  IF v_empresa IS NOT NULL AND NOT EXISTS (SELECT 1 FROM empresas e WHERE e.id = v_empresa AND e.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fornecedor não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_rep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM representantes rp WHERE rp.id = v_rep AND rp.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Representante não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_tipo IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tipos_insumo t WHERE t.id = v_tipo AND t.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Tipo de insumo não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- cores das variantes têm de ser da loja (insumo NÃO tem apelido).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
    WHERE NULLIF(e->>'cor_id','') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.id = (e->>'cor_id')::uuid AND c.tenant_id = v_tenant)
  ) THEN
    RAISE EXCEPTION 'Cor base não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- Resolve o ALVO do upsert. Insumo: unique é NOME só (não fornecedor) → busca por nome norm.
  IF _etiqueta_alvo_id IS NOT NULL THEN
    SELECT id INTO v_existe_id FROM etiquetas WHERE id = _etiqueta_alvo_id AND tenant_id = v_tenant;
    IF v_existe_id IS NULL THEN RAISE EXCEPTION 'Insumo alvo não encontrado na loja.' USING errcode = 'P0001'; END IF;
  ELSE
    SELECT id INTO v_existe_id FROM etiquetas
      WHERE tenant_id = v_tenant AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
      ORDER BY created_at LIMIT 1;
  END IF;

  IF v_existe_id IS NULL THEN
    -- CRIAR (tenant_id pelo trigger; sem código)
    INSERT INTO etiquetas (nome, unidade, empresa_id, representante_id, observacoes, formato_tamanho, tipo_insumo_id, preco)
    VALUES (
      v_nome,
      COALESCE(NULLIF(_cabecalho->>'unidade',''), 'unidade'),
      v_empresa, v_rep,
      NULLIF(_cabecalho->>'observacoes',''),
      COALESCE(NULLIF(_cabecalho->>'formato_tamanho',''), 'ambos'),
      v_tipo,
      NULLIF(_cabecalho->>'preco','')::numeric
    )
    RETURNING id INTO v_id;
    v_acao := 'criado';
  ELSE
    -- COMPLEMENTAR: atualiza o cabeçalho que vier PREENCHIDO (COALESCE não zera) + adiciona variantes.
    v_id := v_existe_id;
    UPDATE etiquetas SET
      unidade         = COALESCE(NULLIF(_cabecalho->>'unidade',''), unidade),
      empresa_id      = COALESCE(v_empresa, empresa_id),
      representante_id= COALESCE(v_rep, representante_id),
      observacoes     = COALESCE(NULLIF(_cabecalho->>'observacoes',''), observacoes),
      formato_tamanho = COALESCE(NULLIF(_cabecalho->>'formato_tamanho',''), formato_tamanho),
      tipo_insumo_id  = COALESCE(v_tipo, tipo_insumo_id),
      preco           = COALESCE(NULLIF(_cabecalho->>'preco','')::numeric, preco)
    WHERE id = v_id AND tenant_id = v_tenant;
  END IF;

  -- variantes: 1 por (cor, tamanho). Insere só as que faltam (índice único combo barra dup → 23505).
  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
  LOOP
    v_cor := NULLIF(r->>'cor_id','')::uuid;
    v_tam := NULLIF(r->>'tamanho','');
    -- combo já existe? (COALESCE p/ casar os NULLs como o índice único faz)
    SELECT id INTO v_var_id FROM variantes_etiqueta
      WHERE etiqueta_id = v_id AND tenant_id = v_tenant
        AND COALESCE(tamanho,'') = COALESCE(v_tam,'')
        AND COALESCE(cor_id,'00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(v_cor,'00000000-0000-0000-0000-000000000000'::uuid)
      LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO variantes_etiqueta (etiqueta_id, cor_id, tamanho, preco)
      VALUES (v_id, v_cor, v_tam, NULLIF(r->>'preco','')::numeric);
      v_novas := v_novas + 1;
    END IF;
  END LOOP;

  IF v_acao <> 'criado' THEN
    v_acao := CASE WHEN v_novas > 0 THEN 'complementado' ELSE 'inalterado' END;
  END IF;

  RETURN jsonb_build_object('etiqueta_id', v_id, 'acao', v_acao, 'variantes_novas', v_novas);
END $function$;

-- Reafirma o REVOKE dos 3 (invariante #9) — idempotente, garante que o CREATE OR REPLACE
-- não reabriu EXECUTE p/ PUBLIC (o default do Postgres concede a PUBLIC ao (re)criar função).
REVOKE EXECUTE ON FUNCTION public.importar_tecido_linha(jsonb, jsonb, uuid[], uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.importar_aviamento_linha(jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.importar_insumo_linha(jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_tecido_linha(jsonb, jsonb, uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.importar_aviamento_linha(jsonb, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.importar_insumo_linha(jsonb, jsonb, uuid) TO authenticated;
