-- Importação em massa (XLSX) — RPC transacional POR LINHA do AVIAMENTO (Fase 2).
--
-- Espelha importar_tecido_linha (upsert incremental) com as diferenças do aviamento:
--  • Nome = `aviamentos.codigo_nome` (não `nome`). Código (`codigo`) é AUTO por trigger — não passar.
--  • Foto é POR-ITEM (`aviamentos.foto_url`, bucket "aviamentos"), NÃO por variante.
--  • 1 categoria (categoria_aviamento_id) + subcategoria + material no cabeçalho (não N-para-N).
--  • Variantes (variantes_aviamento): cor/apelido/nome/codigo/preco (SEM foto — a variante não tem).
--  • Upsert por `codigo_nome` normalizado + MESMO fornecedor (unique uq_aviamento_codigo_fornecedor).
--
-- Retorna {aviamento_id, acao, variantes_novas, fotos_completadas} — acao ∈ criado/complementado/
--   so_foto/inalterado (so_foto = completou a foto do AVIAMENTO que estava vazia; nunca sobrescreve).
-- Guardas: auth/tenant/loja-inativa, IDOR por EXISTS tenant-scoped, apelido↔cor base, REVOKE #9.

BEGIN;

CREATE OR REPLACE FUNCTION public.importar_aviamento_linha(
  _cabecalho jsonb,
  _variantes jsonb,
  _aviamento_alvo_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    -- COMPLEMENTAR: NÃO altera o cabeçalho; só completa a foto do AVIAMENTO se estiver vazia.
    v_id := v_existe_id;
    SELECT foto_url INTO v_foto_atual FROM aviamentos WHERE id = v_id AND tenant_id = v_tenant;
    IF (v_foto_atual IS NULL OR v_foto_atual = '') AND v_foto_nova IS NOT NULL THEN
      UPDATE aviamentos SET foto_url = v_foto_nova WHERE id = v_id AND tenant_id = v_tenant;
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
END $$;

REVOKE EXECUTE ON FUNCTION public.importar_aviamento_linha(jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.importar_aviamento_linha(jsonb, jsonb, uuid) TO authenticated;

COMMIT;
