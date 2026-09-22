-- Importação de MODELO INTERNO — simplificada para SÓ CARD no Planejamento (decisão do dono).
-- Antes (20260927120000) a importação materializava o BOM completo (tecidos/aviamentos/insumos/
-- serviços) — o que "joga no Desenvolvimento", que tem muitas seções. Agora a importação cria
-- apenas o CARD no Planejamento: cabeçalho + grade opcional. O BOM material o usuário monta depois
-- no Desenvolvimento, no fluxo normal — igual a revenda/importado (que também nascem só como card).
--
-- Troca a assinatura (6 jsonb → 2): dropa a versão antiga e cria a nova. Só cria NOVOS (nome interno
-- já existe → PULA). REVOKE dos 3 (invariante #9). Reusa a mesma regra de grade do BOM core
-- (grava modelo_grades só quando grade_total>0 ou algum valor>0).

DROP FUNCTION IF EXISTS public.importar_modelo_linha(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.importar_modelo_linha(_cabecalho jsonb, _grades jsonb)
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
  g jsonb;
  v_grades jsonb;
  v_grade_total numeric;
  v_has_value boolean;
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

  -- Só cria NOVOS: se já existe modelo interno de mesmo nome, PULA.
  SELECT id INTO v_existe_id FROM modelos
    WHERE tenant_id = v_tenant AND origem = 'interno'
      AND public._import_nome_norm(nome) = public._import_nome_norm(v_nome)
    ORDER BY created_at LIMIT 1;
  IF v_existe_id IS NOT NULL THEN
    RETURN jsonb_build_object('modelo_id', v_existe_id, 'acao', 'inalterado');
  END IF;

  -- CRIAR o card (INSERT direto; origem interno; fica no Planejamento — ordem_criacao_enviada=false).
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

  -- Grade (opcional): materializa em modelo_grades (variante 1). Mesma regra do BOM core: só grava
  -- quando grade_total>0 ou algum valor>0. O resto do BOM o usuário monta no Desenvolvimento.
  IF jsonb_typeof(_grades) = 'array' THEN
    FOR g IN SELECT value FROM jsonb_array_elements(_grades) LOOP
      v_grades := COALESCE(g->'grades', '{}'::jsonb);
      v_grade_total := COALESCE((g->>'grade_total')::numeric, 0);
      v_has_value := false;
      IF v_grade_total > 0 THEN
        v_has_value := true;
      ELSIF jsonb_typeof(v_grades) = 'object' THEN
        SELECT EXISTS(SELECT 1 FROM jsonb_each_text(v_grades) WHERE NULLIF(value,'')::numeric > 0) INTO v_has_value;
      END IF;
      IF v_has_value THEN
        INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total)
        VALUES (v_id, COALESCE((g->>'variante_numero')::int, 1), v_grades, v_grade_total);
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('modelo_id', v_id, 'acao', 'criado');
END $function$;

-- Invariante #9: EXECUTE só p/ authenticated.
REVOKE EXECUTE ON FUNCTION public.importar_modelo_linha(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.importar_modelo_linha(jsonb, jsonb) TO authenticated;
