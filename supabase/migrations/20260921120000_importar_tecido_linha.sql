-- Importação em massa (XLSX) — RPC transacional POR LINHA do piloto TECIDO.
--
-- Cria UM tecido (artigos) + suas categorias (set_artigo_categorias) + N variantes
-- (variantes_tecido) de forma ATÔMICA. Espelha o molde `salvar_variantes_aviamento`
-- (20260820120000): guards de auth/tenant/loja-inativa, IDOR por tenant (EXISTS nos
-- lookups), apelido↔cor base, e REVOKE dos TRÊS (invariante #9 — PUBLIC/anon/authenticated).
--
-- Resolvida no CLIENTE: o payload já traz IDs (cor_id, empresa_id, mes_id, ...) — a RPC só
-- valida que pertencem à loja e insere. Erro por linha é isolado no cliente (motor genérico):
-- cada chamada é uma linha; uma falha (ex.: 23505 de variante dup) não derruba as outras.
--
--   _cabecalho    jsonb  { nome, unidade_medida, ncm, empresa_id, representante_id,
--                          composicao, rendimento, preco, mes_id, ano_id }
--   _variantes    jsonb  [ { cor_id, cor_apelido_id?, nome_variante?, codigo_variante?,
--                            preco?, foto_url? } ]
--   _categoria_ids uuid[] categorias de tecido (via set_artigo_categorias)
--   RETURNS uuid  (id do artigo criado)

CREATE OR REPLACE FUNCTION public.importar_tecido_linha(
  _cabecalho jsonb,
  _variantes jsonb,
  _categoria_ids uuid[]
)
RETURNS uuid
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
  IF v_rep IS NOT NULL AND NOT EXISTS (SELECT 1 FROM representantes r WHERE r.id = v_rep AND r.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Representante não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_mes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meses m WHERE m.id = v_mes AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Mês não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_ano IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anos a WHERE a.id = v_ano AND a.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Ano não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- categorias (se informadas) têm de ser da loja.
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

  -- 1) cabeçalho (tenant_id vem do trigger set_tenant_id — nunca no INSERT).
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

  -- 2) categorias (atômico, via a mesma RPC do cadastro manual).
  IF _categoria_ids IS NOT NULL AND array_length(_categoria_ids, 1) IS NOT NULL THEN
    PERFORM public.set_artigo_categorias(v_artigo_id, _categoria_ids);
  END IF;

  -- 3) variantes (1 por cor). O índice único parcial (artigo,cor,apelido) barra duplicata → 23505.
  FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb)) e
           WHERE NULLIF(e->>'cor_id','') IS NOT NULL
  LOOP
    v_cor := (r->>'cor_id')::uuid;
    INSERT INTO variantes_tecido
      (artigo_id, cor_id, cor_apelido_id, nome_variante, codigo_variante, preco, foto_url)
    VALUES (
      v_artigo_id, v_cor,
      NULLIF(r->>'cor_apelido_id','')::uuid,
      NULLIF(r->>'nome_variante',''),
      NULLIF(r->>'codigo_variante',''),
      NULLIF(r->>'preco','')::numeric,
      NULLIF(r->>'foto_url','')
    );
  END LOOP;

  RETURN v_artigo_id;
END $$;

-- Invariante #9: revogar dos TRÊS (PUBLIC/anon herdam), conceder só a authenticated.
REVOKE EXECUTE ON FUNCTION public.importar_tecido_linha(jsonb, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.importar_tecido_linha(jsonb, jsonb, uuid[]) TO authenticated;
