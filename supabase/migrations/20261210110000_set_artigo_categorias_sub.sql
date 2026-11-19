BEGIN;

-- Subcategoria de tecido, Task 2: set_artigo_categorias passa a gravar a sub POR PAR (categoria, sub).
-- Assinatura muda: (uuid, uuid[]) -> (uuid, jsonb). DROP da antiga + CREATE da nova (sem overload: o front e o unico
-- chamador e migra no Task 4; manter as duas confundiria o PostgREST).
-- _pares = [{"categoria_tecido_id":"<uuid>","subcategoria_tecido_id":"<uuid>"|null}, ...]
-- Preserva integralmente a versao viva: SECURITY DEFINER, search_path=public, checagem de tenant, mensagens 'Sem tenant' /
-- 'Tecido não encontrado' e o portao B3 da S3c (so categoria da MESMA loja; a de outra loja e ignorada).
-- A coerencia sub<->categoria por linha vem do gatilho trg_act_sub_mesma_categoria (Task 1): P0001 subcategoria_categoria_diferente.
-- Atomico: delete-all + reinsert na mesma chamada (um par invalido derruba a txn inteira, o tecido nao fica sem categoria).

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.set_artigo_categorias(uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.set_artigo_categorias(_artigo_id uuid, _pares jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id();
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;
  if not exists (select 1 from artigos where id = _artigo_id and tenant_id = v_tenant) then
    raise exception 'Tecido não encontrado';
  end if;
  delete from artigo_categorias_tecido where artigo_id = _artigo_id;
  if _pares is not null and jsonb_typeof(_pares) = 'array' and jsonb_array_length(_pares) > 0 then
    insert into artigo_categorias_tecido (artigo_id, categoria_tecido_id, subcategoria_tecido_id)
    -- [seg s3c] (Reforco de seguranca S3c, B3) so categoria da MESMA loja do tecido; a de outra loja (ou inexistente) e ignorada.
    -- DISTINCT ON: categoria repetida em _pares vira UM par (a 1a ocorrencia vale) - como o any(uuid[]) de antes, nao estoura a UNIQUE (artigo_id, categoria_tecido_id).
    select distinct on (ct.id) _artigo_id, ct.id, nullif(p.elem->>'subcategoria_tecido_id', '')::uuid
      from jsonb_array_elements(_pares) with ordinality as p(elem, ord)
      join public.categorias_tecido ct
        on ct.id = nullif(p.elem->>'categoria_tecido_id', '')::uuid and ct.tenant_id = v_tenant
     order by ct.id, p.ord;
  end if;
end $function$;

REVOKE EXECUTE ON FUNCTION public.set_artigo_categorias(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_artigo_categorias(uuid, jsonb) TO authenticated, service_role;

-- importar_tecido_linha chamava set_artigo_categorias(uuid, uuid[]) em 2 pontos (criar e complementar). Reescrita IDENTICA ao corpo
-- vivo, trocando SO essas 2 chamadas: o array vira jsonb inline (sub sempre null - a planilha nao traz sub; sub so pelo Sheet).
-- A assinatura NAO muda (o front segue passando _categoria_ids uuid[]); o ramo so executa com array nao vazio, entao jsonb_agg nunca devolve NULL.
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
      PERFORM public.set_artigo_categorias(v_artigo_id, (select jsonb_agg(jsonb_build_object('categoria_tecido_id', cid, 'subcategoria_tecido_id', null)) from unnest(_categoria_ids) cid));
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
      PERFORM public.set_artigo_categorias(v_artigo_id, (select jsonb_agg(jsonb_build_object('categoria_tecido_id', cid, 'subcategoria_tecido_id', null)) from unnest(_categoria_ids) cid));
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

COMMIT;
