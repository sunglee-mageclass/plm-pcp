-- Importação em massa — MODELO INTERNO (produção interna) com BOM (Fase 4 final).
-- 4º "tipo" de produto além de revenda/importado, mas estruturalmente diferente: o modelo interno
-- é INSERT direto em `modelos` (origem='interno'), sem tabela-produto nem card-espelho, e carrega
-- um BOM aninhado (tecidos×cores, aviamentos, insumos, grade, serviços) que vem em linhas-filhas
-- na planilha (coluna `tipo_linha` = modelo|tecido|aviamento|insumo|servico), agregadas por nome.
--
-- Decisão do dono: **só cria modelos NOVOS** — se o nome já existe (origem interno), PULA sem
-- tocar em nada (nunca sobrescreve o BOM que possa ter sido editado no Desenvolvimento). Reimportar
-- não duplica nem apaga. O modelo nasce com ordem_criacao_enviada=false (entra no Dev depois, e aí
-- ganha REF pelo fluxo ref_auto da invariante 11).
--
-- A gravação do BOM REUSA os cores já testados em produção: `_salvar_modelo_bom_core` (tecidos+
-- variantes+aviamentos+grades, com IDOR próprio) e `_salvar_modelo_servico_mo_core` (serviços,
-- full-replace). Etiquetas (sem RPC) são inseridas aqui. Todos os IDs vêm resolvidos do cliente;
-- a RPC valida IDOR do CABEÇALHO por EXISTS tenant-scoped (os cores validam o BOM). REVOKE dos 3.

CREATE OR REPLACE FUNCTION public.importar_modelo_linha(
  _cabecalho jsonb, _tecidos jsonb, _aviamentos jsonb, _grades jsonb, _etiquetas jsonb, _servicos jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_categoria uuid;
  v_sub1 uuid;
  v_sub2 uuid;
  v_colecao uuid;
  v_linha uuid;
  v_mes uuid;
  v_ano uuid;
  v_existe_id uuid;
  e jsonb;
  v_etq uuid;
  v_cor uuid;
  v_num int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida' USING errcode = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja' USING errcode = '42501';
  END IF;

  v_nome := NULLIF(btrim(_cabecalho->>'nome'), '');
  IF v_nome IS NULL THEN RAISE EXCEPTION 'Informe o nome do modelo.' USING errcode = 'P0001'; END IF;

  v_categoria := NULLIF(_cabecalho->>'categoria_principal_id','')::uuid;
  v_sub1      := NULLIF(_cabecalho->>'subcategoria1_id','')::uuid;
  v_sub2      := NULLIF(_cabecalho->>'subcategoria2_id','')::uuid;
  v_colecao   := NULLIF(_cabecalho->>'colecao_id','')::uuid;
  v_linha     := NULLIF(_cabecalho->>'linha_id','')::uuid;
  v_mes       := NULLIF(_cabecalho->>'mes_id','')::uuid;
  v_ano       := NULLIF(_cabecalho->>'ano_id','')::uuid;

  IF v_categoria IS NULL THEN
    RAISE EXCEPTION 'Informe a categoria do modelo.' USING errcode = 'P0001';
  END IF;

  -- IDOR do cabeçalho: cada FK tem de ser da MESMA loja.
  IF NOT EXISTS (SELECT 1 FROM categorias_produto c WHERE c.id = v_categoria AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Categoria não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias1_produto s WHERE s.id = v_sub1 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 1 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_sub2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subcategorias2_produto s WHERE s.id = v_sub2 AND s.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Subcategoria 2 não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_colecao IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colecoes cc WHERE cc.id = v_colecao AND cc.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_linha IS NOT NULL AND NOT EXISTS (SELECT 1 FROM linhas l WHERE l.id = v_linha AND l.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Linha não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_mes IS NOT NULL AND NOT EXISTS (SELECT 1 FROM meses m WHERE m.id = v_mes AND m.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Mês não pertence à loja.' USING errcode = 'P0001';
  END IF;
  IF v_ano IS NOT NULL AND NOT EXISTS (SELECT 1 FROM anos a WHERE a.id = v_ano AND a.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Ano não pertence à loja.' USING errcode = 'P0001';
  END IF;

  -- IDOR das etiquetas (o único BOM que não passa por um _core com IDOR próprio).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_etiquetas,'[]'::jsonb)) x
    WHERE NULLIF(x->>'etiqueta_id','') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM etiquetas et WHERE et.id = (x->>'etiqueta_id')::uuid AND et.tenant_id = v_tenant)
  ) THEN RAISE EXCEPTION 'Insumo de outra loja no BOM' USING errcode = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_etiquetas,'[]'::jsonb)) x
    WHERE NULLIF(x->>'cor_id','') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cores c WHERE c.id = (x->>'cor_id')::uuid AND c.tenant_id = v_tenant)
  ) THEN RAISE EXCEPTION 'Cor de insumo de outra loja no BOM' USING errcode = '42501'; END IF;

  -- =========================================================================
  -- Só cria NOVOS: se já existe modelo interno de mesmo nome, PULA (não toca no BOM editado).
  -- =========================================================================
  SELECT id INTO v_existe_id FROM modelos
    WHERE tenant_id = v_tenant AND origem = 'interno'
      AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
    ORDER BY created_at LIMIT 1;
  IF v_existe_id IS NOT NULL THEN
    RETURN jsonb_build_object('modelo_id', v_existe_id, 'acao', 'inalterado');
  END IF;

  -- CRIAR o modelo (INSERT direto; tenant_id pelo trigger set_tenant_id; origem interno; fica no
  -- Planejamento até ser enviado ao Dev manualmente — ordem_criacao_enviada=false por default).
  INSERT INTO modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, mes_id, ano_id, linha_id,
    preco_venda, preco_atacado
  ) VALUES (
    v_tenant, v_nome, 'interno', v_categoria, v_sub1, v_sub2,
    v_colecao, NULLIF(_cabecalho->>'subcolecao',''), NULLIF(_cabecalho->>'semana',''),
    v_mes, v_ano, v_linha,
    NULLIF(_cabecalho->>'preco_venda','')::numeric,
    NULLIF(_cabecalho->>'preco_atacado','')::numeric
  ) RETURNING id INTO v_id;

  -- BOM tecidos+aviamentos+grades: reusa o core (tem IDOR próprio dos ids aninhados). Sem rev_base
  -- (modelo recém-criado, sem concorrência).
  IF (jsonb_typeof(_tecidos)='array' AND jsonb_array_length(_tecidos) > 0)
     OR (jsonb_typeof(_aviamentos)='array' AND jsonb_array_length(_aviamentos) > 0)
     OR (jsonb_typeof(_grades)='array' AND jsonb_array_length(_grades) > 0) THEN
    PERFORM public._salvar_modelo_bom_core(v_id, COALESCE(_tecidos,'[]'::jsonb), COALESCE(_aviamentos,'[]'::jsonb), COALESCE(_grades,'[]'::jsonb), NULL);
  END IF;

  -- Serviços/MO: reusa o core (full-replace, IDOR de categoria próprio).
  IF jsonb_typeof(_servicos)='array' AND jsonb_array_length(_servicos) > 0 THEN
    PERFORM public._salvar_modelo_servico_mo_core(v_id, _servicos);
  END IF;

  -- Etiquetas/insumos (sem RPC): insert direto por etiqueta+cor (numero sequencial).
  IF jsonb_typeof(_etiquetas)='array' THEN
    FOR e IN SELECT value FROM jsonb_array_elements(_etiquetas) LOOP
      v_etq := NULLIF(e->>'etiqueta_id','')::uuid;
      IF v_etq IS NULL THEN CONTINUE; END IF;
      v_cor := NULLIF(e->>'cor_id','')::uuid;
      v_num := v_num + 1;
      INSERT INTO modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
      VALUES (v_tenant, v_id, v_etq, v_cor, v_num,
              COALESCE(NULLIF(e->>'consumo','')::numeric, 0),
              COALESCE(NULLIF(e->>'loss_percent','')::numeric, 0),
              COALESCE(NULLIF(e->>'custo_previsto','')::numeric, 0));
    END LOOP;
  END IF;

  RETURN jsonb_build_object('modelo_id', v_id, 'acao', 'criado');
END $function$;

-- Invariante #9: EXECUTE só p/ authenticated.
REVOKE EXECUTE ON FUNCTION public.importar_modelo_linha(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_modelo_linha(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
