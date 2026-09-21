-- Importação em massa — TECIDO vira UPSERT INCREMENTAL (evolução pedida pelo dono).
--
-- Antes: importar_tecido_linha só CRIAVA (nome duplicado gerava outro artigo). Agora:
--  • Se o tecido já existe (mesmo NOME normalizado + MESMO fornecedor, OU _artigo_alvo_id
--    explícito quando o usuário confirmou "é o mesmo") → COMPLEMENTA: adiciona as variantes
--    que faltam e preenche foto SÓ onde está vazia (NUNCA sobrescreve foto existente — decisão
--    do dono). O cabeçalho do artigo existente NÃO é alterado (só completa o que falta).
--  • Se não existe → cria (comportamento anterior).
-- Retorna jsonb com a AÇÃO p/ o relatório: {artigo_id, acao, variantes_novas, fotos_completadas}.
--   acao ∈ 'criado' | 'complementado' | 'so_foto' | 'inalterado'
--
-- Assinatura nova (retorno uuid → jsonb; parâmetro _artigo_alvo_id) → DROP + CREATE.
-- Mantém todas as guardas de segurança da versão anterior (auth/tenant/IDOR/apelido↔base/#9).

-- Helper: normaliza nome p/ COMPARAÇÃO (espelha normalizeCat do TS — sem acento, minúsculo,
-- colapsa espaços, PRESERVA números). NÃO é _ref_norm (que remove dígitos). IMMUTABLE p/ WHERE.
CREATE OR REPLACE FUNCTION public._import_nome_norm(_s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(regexp_replace(
    translate(coalesce(_s,''),
      'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'),
    '\s+', ' ', 'g')));
$$;
REVOKE EXECUTE ON FUNCTION public._import_nome_norm(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public._import_nome_norm(text) TO authenticated;

DROP FUNCTION IF EXISTS public.importar_tecido_linha(jsonb, jsonb, uuid[]);

CREATE OR REPLACE FUNCTION public.importar_tecido_linha(
  _cabecalho jsonb,
  _variantes jsonb,
  _categoria_ids uuid[],
  _artigo_alvo_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    -- ---------- COMPLEMENTAR (tecido existente) — NÃO altera cabeçalho ----------
    v_artigo_id := v_existe_id;
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
END $$;

REVOKE EXECUTE ON FUNCTION public.importar_tecido_linha(jsonb, jsonb, uuid[], uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.importar_tecido_linha(jsonb, jsonb, uuid[], uuid) TO authenticated;
