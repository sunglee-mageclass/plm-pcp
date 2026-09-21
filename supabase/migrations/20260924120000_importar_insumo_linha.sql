-- Importação em massa (XLSX) — RPC transacional POR LINHA do INSUMO (ex-Etiquetas, Fase 3).
--
-- Espelha importar_aviamento_linha (upsert incremental) com as diferenças do INSUMO:
--  • Nome = `etiquetas.nome`. SEM código auto. Unique = nome só (por loja), NÃO nome+fornecedor
--    → o estado "conflito_fornecedor" NÃO se aplica; o upsert é por NOME puro.
--  • Variante = COR × TAMANHO (`variantes_etiqueta`): {cor_id, tamanho, preco}. SEM apelido, SEM
--    codigo/nome_variante, SEM foto. `tamanho` = "num|letra" da grade (NULL = sem tamanho).
--    O cliente já EXPLODE cor×tamanhos em N variantes (1 por combinação).
--  • Cabeçalho: nome, unidade, empresa_id, representante_id, observacoes, formato_tamanho,
--    tipo_insumo_id. SEM foto/ncm/categoria/material/composicao.
--  • Preço do cabeçalho é DERIVADO (trigger variantes_etiqueta_sync_preco = MAX das variantes) —
--    a RPC grava o preço informado no INSERT, o trigger reajusta se houver variantes com preço.
--
-- Retorna {etiqueta_id, acao, variantes_novas} — acao ∈ criado/complementado/inalterado.
--   (não há "so_foto" — insumo não usa foto.)
-- Guardas: auth/tenant/loja-inativa, IDOR por EXISTS tenant-scoped, REVOKE #9.

BEGIN;

CREATE OR REPLACE FUNCTION public.importar_insumo_linha(
  _cabecalho jsonb,
  _variantes jsonb,
  _etiqueta_alvo_id uuid DEFAULT NULL
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
    -- COMPLEMENTAR: NÃO altera o cabeçalho (só adiciona variantes que faltam).
    v_id := v_existe_id;
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
END $$;

REVOKE EXECUTE ON FUNCTION public.importar_insumo_linha(jsonb, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.importar_insumo_linha(jsonb, jsonb, uuid) TO authenticated;

COMMIT;
