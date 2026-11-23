-- Exportar dados por TIPO (23/nov/2026): 3 RPCs NOVAS (tecido/aviamento/insumo), molde = exportar_produtos (20261122100000).
-- Desenho: docs/superpowers/specs/2026-11-23-exportar-por-tipo-design.md. Plano: docs/superpowers/plans/2026-11-23-exportar-por-tipo.md.
--   exportar_tecidos(_categoria, _campos, _niveis, _limite)                 wrapper DEFINER -> _exportar_tecidos_core(_tenant, ...)
--   exportar_aviamentos(_categoria, _material, _campos, _niveis, _limite)   -> _exportar_aviamentos_core(_tenant, ...)  (Categoria E Material)
--   exportar_insumos(_tipo_insumo, _campos, _niveis, _limite)               -> _exportar_insumos_core(_tenant, ...)
-- Objetos NOVOS (6 funcoes); nenhuma funcao existente e redefinida. Leitura apenas (sem tabela/coluna/gatilho novo).
--
-- Resposta IDENTICA a do export de produto: {colunas:[...], total:N, niveis:{"1":[...],"2":[...]}}; cada linha e um objeto chave -> valor
-- (a ordem pedida vai em `colunas`). Numeros saem como numero JSON (<= 0 ou vazio = null). _limite = modo PREVIA: limita o numero de ITENS
-- (o pai e as variantes de cada item vem completos); `total` e sempre o numero de itens do recorte inteiro (antes do limite). NULL = tudo.
-- NIVEIS (so '1' e '2'; '3' -> exportar_nivel_invalido: 3): 1 = 1 linha por item (pai). 2 = o pai seguido de 1 linha por variante.
-- Os campos "so de variante" ficam null na linha do pai e so tem valor nas linhas de variante; nelas os demais campos herdam o do pai.
--
-- TECIDO (public.artigos + variantes_tecido). Filtro `_categoria` = id da categoria (texto) ou vazio/NULL = todas. A categoria e N:N
--   (artigo_categorias_tecido): o recorte usa EXISTS (NAO join) => 1 linha por tecido mesmo com 2+ pares de categoria. `categorias` e
--   `subcategoria_tecido` saem numa celula so: string_agg(DISTINCT nome, ' | ' ORDER BY nome) (par sem subcategoria nao entra).
--   Variante = cor base + apelido (variantes_tecido). Campos: nome, unidade, composicao, rendimento, ncm, preco, preco_por_metro, largura,
--   fornecedor, mes, ano, categorias, subcategoria_tecido | so variante: cor_base, cor_apelido, codigo_variante.
-- AVIAMENTO (public.aviamentos + variantes_aviamento). DOIS filtros independentes, combinados com E (AND): `_categoria` e `_material`
--   (id em texto; vazio/NULL = todos naquele eixo). O "nome" do aviamento e aviamentos.codigo_nome (NAO existe coluna `nome`).
--   Campos: nome, codigo, ncm, composicao, preco, categoria, subcategoria, material, fornecedor, cor_base_cab, cor_apelido_cab
--   | so variante: cor_base, cor_apelido, codigo_variante, preco_variante.
-- INSUMO (public.etiquetas + variantes_etiqueta). Filtro `_tipo_insumo` = id de tipos_insumo (texto) ou vazio/NULL = todos. Variante =
--   cor x tamanho (variantes_etiqueta; SEM apelido): nivel 1 = 1 linha por insumo; nivel 2 = o pai + 1 linha por variante (cor e tamanho
--   na mesma linha). Insumo sem variante sai so com o pai. Campos: nome, unidade, tipo_insumo, formato_tamanho, preco, fornecedor, observacoes
--   | so variante: cor, tamanho, preco_variante.
-- fornecedor = empresas.nome_fantasia [+ ' - ' + representantes.nome] (ASCII).
--
-- Erros (P0001, ASCII): exportar_sem_loja, exportar_campos_vazio, exportar_campo_invalido: <chave>, exportar_niveis_vazio,
-- exportar_nivel_invalido: <valor>, exportar_limite_invalido e NOVO exportar_filtro_invalido (id que nao e uuid ou nao e da loja).
-- Gate = _exportar_exige() (o portao do export de produto HOJE; 20261201130000): login + loja ativa + permissao `exportar_dados` (42501).
-- Seguranca: DEFINER + search_path=public; o _core recebe a loja por parametro (NAO chamavel pelo cliente: REVOKE dos TRES de cada _core);
-- todo lookup (categoria/sub/material/tipo/cor/fornecedor/mes/ano/variante) e filtrado pela LOJA do item.
-- Trava: so catalogo (CREATE FUNCTION + GRANT/REVOKE). Nada em auth/storage/realtime. Idempotente (CREATE OR REPLACE).
-- Volta: supabase/rollback/20261212100000_exportar_por_tipo_down.sql (DROP das 6 funcoes). Banco ANTES do site.
-- PRE-REQUISITO: a 20261201130000 aplicada (_exportar_exige existe). Aplicar fora de txn de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>.
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_n int;
BEGIN
  IF to_regprocedure('public._exportar_exige()') IS NULL THEN
    RAISE EXCEPTION 'exportar_por_tipo_dep: _exportar_exige() ausente - aplicar 20261201130000 antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._integracao_num(numeric,integer)') IS NULL THEN
    RAISE EXCEPTION 'exportar_por_tipo_dep: _integracao_num(numeric,integer) ausente' USING ERRCODE = 'P0001';
  END IF;
  -- sobrecarga com outros argumentos deixaria a chamada por nome ambigua no PostgREST
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'exportar_tecidos' AND p.pronargs <> 4;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'exportar_sobrecarga: % sobrecarga(s) de public.exportar_tecidos com outros argumentos', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'exportar_aviamentos' AND p.pronargs <> 5;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'exportar_sobrecarga: % sobrecarga(s) de public.exportar_aviamentos com outros argumentos', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'exportar_insumos' AND p.pronargs <> 4;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'exportar_sobrecarga: % sobrecarga(s) de public.exportar_insumos com outros argumentos', v_n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- =====================================================================================================================
-- TECIDO
-- =====================================================================================================================
CREATE OR REPLACE FUNCTION public._exportar_tecidos_core(
  _tenant uuid, _categoria text, _campos text[], _niveis text[], _limite integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_catalogo constant text[] := ARRAY['nome', 'unidade', 'composicao', 'rendimento', 'ncm', 'preco', 'preco_por_metro',
    'largura', 'fornecedor', 'mes', 'ano', 'categorias', 'subcategoria_tecido', 'cor_base', 'cor_apelido', 'codigo_variante'];
  v_ruim text;
  v_campos text[];
  v_niveis text[];
  v_cat text := nullif(btrim(coalesce(_categoria, '')), '');
  v_filtro uuid;
  v_n1 boolean;
  v_n2 boolean;
  v_total integer;
  v_ids uuid[];
  v_tem_cor boolean;
  v_tem_apelido boolean;
  v_tem_cod boolean;
  v_tem_cats boolean;
  v_tem_subs boolean;
  r record;
  s record;
  c text;
  v_val jsonb;
  v_pai jsonb;
  v_fil jsonb;
  v_l1 jsonb[] := '{}'::jsonb[];
  v_l2 jsonb[] := '{}'::jsonb[];
  v_niv jsonb := '{}'::jsonb;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'exportar_sem_loja' USING ERRCODE = 'P0001';
  END IF;

  -- campos: so chaves do catalogo, sem repetir, na ORDEM pedida
  IF _campos IS NULL OR cardinality(_campos) = 0 THEN
    RAISE EXCEPTION 'exportar_campos_vazio' USING ERRCODE = 'P0001';
  END IF;
  SELECT x INTO v_ruim FROM unnest(_campos) AS u(x) WHERE x IS NULL OR NOT (x = ANY (v_catalogo)) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'exportar_campo_invalido: %', coalesce(v_ruim, 'null') USING ERRCODE = 'P0001';
  END IF;
  v_campos := ARRAY(SELECT d.x FROM (SELECT DISTINCT ON (u.x) u.x, u.n FROM unnest(_campos) WITH ORDINALITY AS u(x, n)
                                      ORDER BY u.x, u.n) d ORDER BY d.n);

  -- niveis: '1' | '2' (tecido nao tem nivel 3)
  IF _niveis IS NULL OR cardinality(_niveis) = 0 THEN
    RAISE EXCEPTION 'exportar_niveis_vazio' USING ERRCODE = 'P0001';
  END IF;
  SELECT x INTO v_ruim FROM unnest(_niveis) AS u(x) WHERE x IS NULL OR x NOT IN ('1', '2') LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'exportar_nivel_invalido: %', coalesce(v_ruim, 'null') USING ERRCODE = 'P0001';
  END IF;
  v_niveis := ARRAY(SELECT DISTINCT u.x FROM unnest(_niveis) AS u(x) ORDER BY 1);
  v_n1 := '1' = ANY (v_niveis);
  v_n2 := '2' = ANY (v_niveis);

  IF _limite IS NOT NULL AND _limite < 1 THEN
    RAISE EXCEPTION 'exportar_limite_invalido' USING ERRCODE = 'P0001';
  END IF;

  -- filtro de categoria (N:N): id em texto; vazio/NULL = todas; nao-uuid ou de outra loja = exportar_filtro_invalido
  IF v_cat IS NOT NULL THEN
    IF v_cat !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
    v_filtro := v_cat::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.categorias_tecido ct WHERE ct.id = v_filtro AND ct.tenant_id = _tenant) THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- RECORTE: artigos da loja; com filtro, EXISTS no par (NAO join => 1 linha por tecido, mesmo com a categoria em 2+ pares)
  SELECT count(*) INTO v_total
    FROM public.artigos a
   WHERE a.tenant_id = _tenant
     AND (v_filtro IS NULL OR EXISTS (SELECT 1 FROM public.artigo_categorias_tecido act
                                       WHERE act.artigo_id = a.id AND act.categoria_tecido_id = v_filtro));

  v_ids := ARRAY(
    SELECT a.id
      FROM public.artigos a
     WHERE a.tenant_id = _tenant
       AND (v_filtro IS NULL OR EXISTS (SELECT 1 FROM public.artigo_categorias_tecido act
                                         WHERE act.artigo_id = a.id AND act.categoria_tecido_id = v_filtro))
     ORDER BY a.nome, a.id
     LIMIT _limite);

  v_tem_cor := 'cor_base' = ANY (v_campos);
  v_tem_apelido := 'cor_apelido' = ANY (v_campos);
  v_tem_cod := 'codigo_variante' = ANY (v_campos);
  v_tem_cats := 'categorias' = ANY (v_campos);
  v_tem_subs := 'subcategoria_tecido' = ANY (v_campos);

  FOR r IN
    SELECT a.id, a.nome::text AS nome, a.unidade_medida::text AS unidade, a.composicao, a.rendimento, a.ncm, a.preco,
           a.preco_por_metro, a.largura_estimada,
           nullif(concat_ws(' - ', nullif(btrim(e.nome_fantasia::text), ''), nullif(btrim(rp.nome::text), '')), '') AS fornecedor,
           me.mes::text AS mes, an.ano::text AS ano,
           CASE WHEN v_tem_cats THEN
             (SELECT string_agg(DISTINCT ct.nome::text, ' | ' ORDER BY ct.nome::text)
                FROM public.artigo_categorias_tecido act
                JOIN public.categorias_tecido ct ON ct.id = act.categoria_tecido_id AND ct.tenant_id = a.tenant_id
               WHERE act.artigo_id = a.id) END AS categorias,
           CASE WHEN v_tem_subs THEN
             (SELECT string_agg(DISTINCT st.nome::text, ' | ' ORDER BY st.nome::text)
                FROM public.artigo_categorias_tecido act
                JOIN public.subcategorias_tecido st ON st.id = act.subcategoria_tecido_id AND st.tenant_id = a.tenant_id
               WHERE act.artigo_id = a.id) END AS subcategorias
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, n)
      JOIN public.artigos a ON a.id = u.id AND a.tenant_id = _tenant
      LEFT JOIN public.empresas e ON e.id = a.empresa_id AND e.tenant_id = a.tenant_id
      LEFT JOIN public.representantes rp ON rp.id = a.representante_id AND rp.tenant_id = a.tenant_id
      LEFT JOIN public.meses me ON me.id = a.mes_id AND me.tenant_id = a.tenant_id
      LEFT JOIN public.anos an ON an.id = a.ano_id AND an.tenant_id = a.tenant_id
     ORDER BY u.n
  LOOP
    -- linha do PAI: os campos pedidos (cor_base/cor_apelido/codigo_variante so existem nas linhas de variante)
    v_pai := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      v_val := CASE c
        WHEN 'nome' THEN to_jsonb(nullif(btrim(coalesce(r.nome, '')), ''))
        WHEN 'unidade' THEN to_jsonb(nullif(btrim(coalesce(r.unidade, '')), ''))
        WHEN 'composicao' THEN to_jsonb(nullif(btrim(coalesce(r.composicao, '')), ''))
        WHEN 'rendimento' THEN to_jsonb(public._integracao_num(r.rendimento, NULL)::numeric)
        WHEN 'ncm' THEN to_jsonb(nullif(btrim(coalesce(r.ncm, '')), ''))
        WHEN 'preco' THEN to_jsonb(public._integracao_num(r.preco, 2)::numeric)
        WHEN 'preco_por_metro' THEN to_jsonb(public._integracao_num(r.preco_por_metro, 2)::numeric)
        WHEN 'largura' THEN to_jsonb(public._integracao_num(r.largura_estimada, NULL)::numeric)
        WHEN 'fornecedor' THEN to_jsonb(r.fornecedor)
        WHEN 'mes' THEN to_jsonb(nullif(btrim(coalesce(r.mes, '')), ''))
        WHEN 'ano' THEN to_jsonb(nullif(btrim(coalesce(r.ano, '')), ''))
        WHEN 'categorias' THEN to_jsonb(nullif(btrim(coalesce(r.categorias, '')), ''))
        WHEN 'subcategoria_tecido' THEN to_jsonb(nullif(btrim(coalesce(r.subcategorias, '')), ''))
        ELSE NULL  -- cor_base / cor_apelido / codigo_variante: so nas linhas de variante
      END;
      v_pai := v_pai || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    END LOOP;

    IF v_n1 THEN v_l1 := v_l1 || v_pai; END IF;
    IF v_n2 THEN
      v_l2 := v_l2 || v_pai;
      -- filhas: 1 linha por variante (cor base + apelido) do tecido, da loja
      FOR s IN
        SELECT co.nome::text AS cor_nome, ap.nome::text AS apelido_nome, vt.codigo_variante::text AS codigo
          FROM public.variantes_tecido vt
          LEFT JOIN public.cores co ON co.id = vt.cor_id AND co.tenant_id = _tenant
          LEFT JOIN public.cores_apelido ap ON ap.id = vt.cor_apelido_id AND ap.tenant_id = _tenant
         WHERE vt.artigo_id = r.id AND vt.tenant_id = _tenant
         ORDER BY co.nome NULLS LAST, ap.nome NULLS LAST, vt.created_at, vt.id
      LOOP
        v_fil := v_pai;
        IF v_tem_cor THEN v_fil := v_fil || jsonb_build_object('cor_base', coalesce(to_jsonb(nullif(btrim(coalesce(s.cor_nome, '')), '')), 'null'::jsonb)); END IF;
        IF v_tem_apelido THEN v_fil := v_fil || jsonb_build_object('cor_apelido', coalesce(to_jsonb(nullif(btrim(coalesce(s.apelido_nome, '')), '')), 'null'::jsonb)); END IF;
        IF v_tem_cod THEN v_fil := v_fil || jsonb_build_object('codigo_variante', coalesce(to_jsonb(nullif(btrim(coalesce(s.codigo, '')), '')), 'null'::jsonb)); END IF;
        v_l2 := v_l2 || v_fil;
      END LOOP;
    END IF;
  END LOOP;

  IF v_n1 THEN v_niv := v_niv || jsonb_build_object('1', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l1) AS x), '[]'::jsonb)); END IF;
  IF v_n2 THEN v_niv := v_niv || jsonb_build_object('2', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l2) AS x), '[]'::jsonb)); END IF;

  RETURN jsonb_build_object('colunas', to_jsonb(v_campos), 'total', v_total, 'niveis', v_niv);
END
$function$;

CREATE OR REPLACE FUNCTION public.exportar_tecidos(
  _categoria text, _campos text[], _niveis text[], _limite integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._exportar_exige();  -- login + loja ativa + permissao `exportar_dados`
BEGIN
  RETURN public._exportar_tecidos_core(v_tenant, _categoria, _campos, _niveis, _limite);
END
$function$;

-- =====================================================================================================================
-- AVIAMENTO (DOIS filtros independentes, combinados com E)
-- =====================================================================================================================
CREATE OR REPLACE FUNCTION public._exportar_aviamentos_core(
  _tenant uuid, _categoria text, _material text, _campos text[], _niveis text[], _limite integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_catalogo constant text[] := ARRAY['nome', 'codigo', 'ncm', 'composicao', 'preco', 'categoria', 'subcategoria', 'material',
    'fornecedor', 'cor_base_cab', 'cor_apelido_cab', 'cor_base', 'cor_apelido', 'codigo_variante', 'preco_variante'];
  v_ruim text;
  v_campos text[];
  v_niveis text[];
  v_cat text := nullif(btrim(coalesce(_categoria, '')), '');
  v_mat text := nullif(btrim(coalesce(_material, '')), '');
  v_cat_id uuid;
  v_mat_id uuid;
  v_n1 boolean;
  v_n2 boolean;
  v_total integer;
  v_ids uuid[];
  v_tem_cor boolean;
  v_tem_apelido boolean;
  v_tem_cod boolean;
  v_tem_precov boolean;
  r record;
  s record;
  c text;
  v_val jsonb;
  v_pai jsonb;
  v_fil jsonb;
  v_l1 jsonb[] := '{}'::jsonb[];
  v_l2 jsonb[] := '{}'::jsonb[];
  v_niv jsonb := '{}'::jsonb;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'exportar_sem_loja' USING ERRCODE = 'P0001';
  END IF;

  -- campos: so chaves do catalogo, sem repetir, na ORDEM pedida
  IF _campos IS NULL OR cardinality(_campos) = 0 THEN
    RAISE EXCEPTION 'exportar_campos_vazio' USING ERRCODE = 'P0001';
  END IF;
  SELECT x INTO v_ruim FROM unnest(_campos) AS u(x) WHERE x IS NULL OR NOT (x = ANY (v_catalogo)) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'exportar_campo_invalido: %', coalesce(v_ruim, 'null') USING ERRCODE = 'P0001';
  END IF;
  v_campos := ARRAY(SELECT d.x FROM (SELECT DISTINCT ON (u.x) u.x, u.n FROM unnest(_campos) WITH ORDINALITY AS u(x, n)
                                      ORDER BY u.x, u.n) d ORDER BY d.n);

  -- niveis: '1' | '2' (aviamento nao tem nivel 3)
  IF _niveis IS NULL OR cardinality(_niveis) = 0 THEN
    RAISE EXCEPTION 'exportar_niveis_vazio' USING ERRCODE = 'P0001';
  END IF;
  SELECT x INTO v_ruim FROM unnest(_niveis) AS u(x) WHERE x IS NULL OR x NOT IN ('1', '2') LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'exportar_nivel_invalido: %', coalesce(v_ruim, 'null') USING ERRCODE = 'P0001';
  END IF;
  v_niveis := ARRAY(SELECT DISTINCT u.x FROM unnest(_niveis) AS u(x) ORDER BY 1);
  v_n1 := '1' = ANY (v_niveis);
  v_n2 := '2' = ANY (v_niveis);

  IF _limite IS NOT NULL AND _limite < 1 THEN
    RAISE EXCEPTION 'exportar_limite_invalido' USING ERRCODE = 'P0001';
  END IF;

  -- filtro de CATEGORIA: id em texto; vazio/NULL = todas; nao-uuid ou de outra loja = exportar_filtro_invalido
  IF v_cat IS NOT NULL THEN
    IF v_cat !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
    v_cat_id := v_cat::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.categorias_aviamento ca WHERE ca.id = v_cat_id AND ca.tenant_id = _tenant) THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  -- filtro de MATERIAL: idem
  IF v_mat IS NOT NULL THEN
    IF v_mat !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
    v_mat_id := v_mat::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.materiais_aviamento ma WHERE ma.id = v_mat_id AND ma.tenant_id = _tenant) THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- RECORTE (E / AND): aviamentos da loja; cada filtro vazio = todos naquele eixo. ORDER BY codigo_nome, id.
  SELECT count(*) INTO v_total
    FROM public.aviamentos a
   WHERE a.tenant_id = _tenant
     AND (v_cat_id IS NULL OR a.categoria_aviamento_id = v_cat_id)
     AND (v_mat_id IS NULL OR a.material_aviamento_id = v_mat_id);

  v_ids := ARRAY(
    SELECT a.id
      FROM public.aviamentos a
     WHERE a.tenant_id = _tenant
       AND (v_cat_id IS NULL OR a.categoria_aviamento_id = v_cat_id)
       AND (v_mat_id IS NULL OR a.material_aviamento_id = v_mat_id)
     ORDER BY a.codigo_nome, a.id
     LIMIT _limite);

  v_tem_cor := 'cor_base' = ANY (v_campos);
  v_tem_apelido := 'cor_apelido' = ANY (v_campos);
  v_tem_cod := 'codigo_variante' = ANY (v_campos);
  v_tem_precov := 'preco_variante' = ANY (v_campos);

  FOR r IN
    SELECT a.id, a.codigo_nome::text AS nome, a.codigo::text AS codigo, a.ncm, a.composicao, a.preco,
           ca.nome::text AS categoria, sa.nome::text AS subcategoria, ma.nome::text AS material,
           nullif(concat_ws(' - ', nullif(btrim(e.nome_fantasia::text), ''), nullif(btrim(rp.nome::text), '')), '') AS fornecedor,
           cc.nome::text AS cor_cab, ac.nome::text AS apelido_cab
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, n)
      JOIN public.aviamentos a ON a.id = u.id AND a.tenant_id = _tenant
      LEFT JOIN public.categorias_aviamento ca ON ca.id = a.categoria_aviamento_id AND ca.tenant_id = a.tenant_id
      LEFT JOIN public.subcategorias_aviamento sa ON sa.id = a.subcategoria_aviamento_id AND sa.tenant_id = a.tenant_id
      LEFT JOIN public.materiais_aviamento ma ON ma.id = a.material_aviamento_id AND ma.tenant_id = a.tenant_id
      LEFT JOIN public.empresas e ON e.id = a.empresa_id AND e.tenant_id = a.tenant_id
      LEFT JOIN public.representantes rp ON rp.id = a.representante_id AND rp.tenant_id = a.tenant_id
      LEFT JOIN public.cores cc ON cc.id = a.cor_id AND cc.tenant_id = a.tenant_id
      LEFT JOIN public.cores_apelido ac ON ac.id = a.cor_apelido_id AND ac.tenant_id = a.tenant_id
     ORDER BY u.n
  LOOP
    -- linha do PAI: os campos pedidos (cor_base/cor_apelido/codigo_variante/preco_variante so existem nas linhas de variante)
    v_pai := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      v_val := CASE c
        WHEN 'nome' THEN to_jsonb(nullif(btrim(coalesce(r.nome, '')), ''))
        WHEN 'codigo' THEN to_jsonb(nullif(btrim(coalesce(r.codigo, '')), ''))
        WHEN 'ncm' THEN to_jsonb(nullif(btrim(coalesce(r.ncm, '')), ''))
        WHEN 'composicao' THEN to_jsonb(nullif(btrim(coalesce(r.composicao, '')), ''))
        WHEN 'preco' THEN to_jsonb(public._integracao_num(r.preco, 2)::numeric)
        WHEN 'categoria' THEN to_jsonb(nullif(btrim(coalesce(r.categoria, '')), ''))
        WHEN 'subcategoria' THEN to_jsonb(nullif(btrim(coalesce(r.subcategoria, '')), ''))
        WHEN 'material' THEN to_jsonb(nullif(btrim(coalesce(r.material, '')), ''))
        WHEN 'fornecedor' THEN to_jsonb(r.fornecedor)
        WHEN 'cor_base_cab' THEN to_jsonb(nullif(btrim(coalesce(r.cor_cab, '')), ''))
        WHEN 'cor_apelido_cab' THEN to_jsonb(nullif(btrim(coalesce(r.apelido_cab, '')), ''))
        ELSE NULL  -- cor_base / cor_apelido / codigo_variante / preco_variante: so nas linhas de variante
      END;
      v_pai := v_pai || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    END LOOP;

    IF v_n1 THEN v_l1 := v_l1 || v_pai; END IF;
    IF v_n2 THEN
      v_l2 := v_l2 || v_pai;
      -- filhas: 1 linha por variante (cor base + apelido) do aviamento, da loja
      FOR s IN
        SELECT co.nome::text AS cor_nome, ap.nome::text AS apelido_nome, va.codigo_variante::text AS codigo, va.preco AS preco
          FROM public.variantes_aviamento va
          LEFT JOIN public.cores co ON co.id = va.cor_id AND co.tenant_id = _tenant
          LEFT JOIN public.cores_apelido ap ON ap.id = va.cor_apelido_id AND ap.tenant_id = _tenant
         WHERE va.aviamento_id = r.id AND va.tenant_id = _tenant
         ORDER BY co.nome NULLS LAST, ap.nome NULLS LAST, va.created_at, va.id
      LOOP
        v_fil := v_pai;
        IF v_tem_cor THEN v_fil := v_fil || jsonb_build_object('cor_base', coalesce(to_jsonb(nullif(btrim(coalesce(s.cor_nome, '')), '')), 'null'::jsonb)); END IF;
        IF v_tem_apelido THEN v_fil := v_fil || jsonb_build_object('cor_apelido', coalesce(to_jsonb(nullif(btrim(coalesce(s.apelido_nome, '')), '')), 'null'::jsonb)); END IF;
        IF v_tem_cod THEN v_fil := v_fil || jsonb_build_object('codigo_variante', coalesce(to_jsonb(nullif(btrim(coalesce(s.codigo, '')), '')), 'null'::jsonb)); END IF;
        IF v_tem_precov THEN v_fil := v_fil || jsonb_build_object('preco_variante', coalesce(to_jsonb(public._integracao_num(s.preco, 2)::numeric), 'null'::jsonb)); END IF;
        v_l2 := v_l2 || v_fil;
      END LOOP;
    END IF;
  END LOOP;

  IF v_n1 THEN v_niv := v_niv || jsonb_build_object('1', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l1) AS x), '[]'::jsonb)); END IF;
  IF v_n2 THEN v_niv := v_niv || jsonb_build_object('2', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l2) AS x), '[]'::jsonb)); END IF;

  RETURN jsonb_build_object('colunas', to_jsonb(v_campos), 'total', v_total, 'niveis', v_niv);
END
$function$;

CREATE OR REPLACE FUNCTION public.exportar_aviamentos(
  _categoria text, _material text, _campos text[], _niveis text[], _limite integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._exportar_exige();  -- login + loja ativa + permissao `exportar_dados`
BEGIN
  RETURN public._exportar_aviamentos_core(v_tenant, _categoria, _material, _campos, _niveis, _limite);
END
$function$;

-- =====================================================================================================================
-- INSUMO (variante = cor x tamanho, SEM apelido)
-- =====================================================================================================================
CREATE OR REPLACE FUNCTION public._exportar_insumos_core(
  _tenant uuid, _tipo_insumo text, _campos text[], _niveis text[], _limite integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_catalogo constant text[] := ARRAY['nome', 'unidade', 'tipo_insumo', 'formato_tamanho', 'preco', 'fornecedor', 'observacoes',
    'cor', 'tamanho', 'preco_variante'];
  v_ruim text;
  v_campos text[];
  v_niveis text[];
  v_tp text := nullif(btrim(coalesce(_tipo_insumo, '')), '');
  v_tipo uuid;
  v_n1 boolean;
  v_n2 boolean;
  v_total integer;
  v_ids uuid[];
  v_tem_cor boolean;
  v_tem_tam boolean;
  v_tem_precov boolean;
  r record;
  s record;
  c text;
  v_val jsonb;
  v_pai jsonb;
  v_fil jsonb;
  v_l1 jsonb[] := '{}'::jsonb[];
  v_l2 jsonb[] := '{}'::jsonb[];
  v_niv jsonb := '{}'::jsonb;
BEGIN
  IF _tenant IS NULL THEN
    RAISE EXCEPTION 'exportar_sem_loja' USING ERRCODE = 'P0001';
  END IF;

  -- campos: so chaves do catalogo, sem repetir, na ORDEM pedida
  IF _campos IS NULL OR cardinality(_campos) = 0 THEN
    RAISE EXCEPTION 'exportar_campos_vazio' USING ERRCODE = 'P0001';
  END IF;
  SELECT x INTO v_ruim FROM unnest(_campos) AS u(x) WHERE x IS NULL OR NOT (x = ANY (v_catalogo)) LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'exportar_campo_invalido: %', coalesce(v_ruim, 'null') USING ERRCODE = 'P0001';
  END IF;
  v_campos := ARRAY(SELECT d.x FROM (SELECT DISTINCT ON (u.x) u.x, u.n FROM unnest(_campos) WITH ORDINALITY AS u(x, n)
                                      ORDER BY u.x, u.n) d ORDER BY d.n);

  -- niveis: '1' | '2' (insumo nao tem nivel 3: o nivel 2 ja carrega o tamanho)
  IF _niveis IS NULL OR cardinality(_niveis) = 0 THEN
    RAISE EXCEPTION 'exportar_niveis_vazio' USING ERRCODE = 'P0001';
  END IF;
  SELECT x INTO v_ruim FROM unnest(_niveis) AS u(x) WHERE x IS NULL OR x NOT IN ('1', '2') LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'exportar_nivel_invalido: %', coalesce(v_ruim, 'null') USING ERRCODE = 'P0001';
  END IF;
  v_niveis := ARRAY(SELECT DISTINCT u.x FROM unnest(_niveis) AS u(x) ORDER BY 1);
  v_n1 := '1' = ANY (v_niveis);
  v_n2 := '2' = ANY (v_niveis);

  IF _limite IS NOT NULL AND _limite < 1 THEN
    RAISE EXCEPTION 'exportar_limite_invalido' USING ERRCODE = 'P0001';
  END IF;

  -- filtro de TIPO DE INSUMO: id em texto; vazio/NULL = todos; nao-uuid ou de outra loja = exportar_filtro_invalido
  IF v_tp IS NOT NULL THEN
    IF v_tp !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
    v_tipo := v_tp::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.tipos_insumo ti WHERE ti.id = v_tipo AND ti.tenant_id = _tenant) THEN
      RAISE EXCEPTION 'exportar_filtro_invalido' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- RECORTE: insumos (etiquetas) da loja; ORDER BY nome, id
  SELECT count(*) INTO v_total
    FROM public.etiquetas e
   WHERE e.tenant_id = _tenant
     AND (v_tipo IS NULL OR e.tipo_insumo_id = v_tipo);

  v_ids := ARRAY(
    SELECT e.id
      FROM public.etiquetas e
     WHERE e.tenant_id = _tenant
       AND (v_tipo IS NULL OR e.tipo_insumo_id = v_tipo)
     ORDER BY e.nome, e.id
     LIMIT _limite);

  v_tem_cor := 'cor' = ANY (v_campos);
  v_tem_tam := 'tamanho' = ANY (v_campos);
  v_tem_precov := 'preco_variante' = ANY (v_campos);

  FOR r IN
    SELECT e.id, e.nome::text AS nome, e.unidade::text AS unidade, ti.nome::text AS tipo_insumo, e.formato_tamanho::text AS formato_tamanho,
           e.preco, e.observacoes,
           nullif(concat_ws(' - ', nullif(btrim(em.nome_fantasia::text), ''), nullif(btrim(rp.nome::text), '')), '') AS fornecedor
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, n)
      JOIN public.etiquetas e ON e.id = u.id AND e.tenant_id = _tenant
      LEFT JOIN public.tipos_insumo ti ON ti.id = e.tipo_insumo_id AND ti.tenant_id = e.tenant_id
      LEFT JOIN public.empresas em ON em.id = e.empresa_id AND em.tenant_id = e.tenant_id
      LEFT JOIN public.representantes rp ON rp.id = e.representante_id AND rp.tenant_id = e.tenant_id
     ORDER BY u.n
  LOOP
    -- linha do PAI: os campos pedidos (cor/tamanho/preco_variante so existem nas linhas de variante)
    v_pai := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      v_val := CASE c
        WHEN 'nome' THEN to_jsonb(nullif(btrim(coalesce(r.nome, '')), ''))
        WHEN 'unidade' THEN to_jsonb(nullif(btrim(coalesce(r.unidade, '')), ''))
        WHEN 'tipo_insumo' THEN to_jsonb(nullif(btrim(coalesce(r.tipo_insumo, '')), ''))
        WHEN 'formato_tamanho' THEN to_jsonb(nullif(btrim(coalesce(r.formato_tamanho, '')), ''))
        WHEN 'preco' THEN to_jsonb(public._integracao_num(r.preco, 2)::numeric)
        WHEN 'fornecedor' THEN to_jsonb(r.fornecedor)
        WHEN 'observacoes' THEN to_jsonb(nullif(btrim(coalesce(r.observacoes, '')), ''))
        ELSE NULL  -- cor / tamanho / preco_variante: so nas linhas de variante
      END;
      v_pai := v_pai || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    END LOOP;

    IF v_n1 THEN v_l1 := v_l1 || v_pai; END IF;
    IF v_n2 THEN
      v_l2 := v_l2 || v_pai;
      -- filhas: 1 linha por variante cor x tamanho (variantes_etiqueta; SEM apelido), da loja
      FOR s IN
        SELECT co.nome::text AS cor_nome, ve.tamanho AS tamanho, ve.preco AS preco
          FROM public.variantes_etiqueta ve
          LEFT JOIN public.cores co ON co.id = ve.cor_id AND co.tenant_id = _tenant
         WHERE ve.etiqueta_id = r.id AND ve.tenant_id = _tenant
         ORDER BY co.nome NULLS LAST, ve.created_at, ve.id
      LOOP
        v_fil := v_pai;
        IF v_tem_cor THEN v_fil := v_fil || jsonb_build_object('cor', coalesce(to_jsonb(nullif(btrim(coalesce(s.cor_nome, '')), '')), 'null'::jsonb)); END IF;
        IF v_tem_tam THEN v_fil := v_fil || jsonb_build_object('tamanho', coalesce(to_jsonb(nullif(btrim(coalesce(s.tamanho, '')), '')), 'null'::jsonb)); END IF;
        IF v_tem_precov THEN v_fil := v_fil || jsonb_build_object('preco_variante', coalesce(to_jsonb(public._integracao_num(s.preco, 2)::numeric), 'null'::jsonb)); END IF;
        v_l2 := v_l2 || v_fil;
      END LOOP;
    END IF;
  END LOOP;

  IF v_n1 THEN v_niv := v_niv || jsonb_build_object('1', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l1) AS x), '[]'::jsonb)); END IF;
  IF v_n2 THEN v_niv := v_niv || jsonb_build_object('2', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l2) AS x), '[]'::jsonb)); END IF;

  RETURN jsonb_build_object('colunas', to_jsonb(v_campos), 'total', v_total, 'niveis', v_niv);
END
$function$;

CREATE OR REPLACE FUNCTION public.exportar_insumos(
  _tipo_insumo text, _campos text[], _niveis text[], _limite integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._exportar_exige();  -- login + loja ativa + permissao `exportar_dados`
BEGIN
  RETURN public._exportar_insumos_core(v_tenant, _tipo_insumo, _campos, _niveis, _limite);
END
$function$;

-- =====================================================================================================================
-- ACL: REVOKE dos TRES em cada _core (PUBLIC herdado por anon/authenticated); wrappers so authenticated/service_role
-- =====================================================================================================================
REVOKE EXECUTE ON FUNCTION public._exportar_tecidos_core(uuid, text, text[], text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._exportar_aviamentos_core(uuid, text, text, text[], text[], integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._exportar_insumos_core(uuid, text, text[], text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exportar_tecidos_core(uuid, text, text[], text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public._exportar_aviamentos_core(uuid, text, text, text[], text[], integer) TO service_role;
GRANT EXECUTE ON FUNCTION public._exportar_insumos_core(uuid, text, text[], text[], integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.exportar_tecidos(text, text[], text[], integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exportar_aviamentos(text, text, text[], text[], integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.exportar_insumos(text, text[], text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exportar_tecidos(text, text[], text[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exportar_aviamentos(text, text, text[], text[], integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.exportar_insumos(text, text[], text[], integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.exportar_tecidos(text, text[], text[], integer) IS
  'Exportar dados (por tipo): tecidos da loja por categoria (N:N), com campos e niveis (cabecalho / ate variante).';
COMMENT ON FUNCTION public.exportar_aviamentos(text, text, text[], text[], integer) IS
  'Exportar dados (por tipo): aviamentos da loja por categoria E material, com campos e niveis (cabecalho / ate variante).';
COMMENT ON FUNCTION public.exportar_insumos(text, text[], text[], integer) IS
  'Exportar dados (por tipo): insumos da loja por tipo de insumo, com campos e niveis (cabecalho / ate variante cor x tamanho).';

-- pos-condicoes (IDOR, invariante #9): _core NAO executavel por anon/authenticated; wrapper NAO executavel por anon
DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY[
      'public._exportar_tecidos_core(uuid,text,text[],text[],integer)',
      'public._exportar_aviamentos_core(uuid,text,text,text[],text[],integer)',
      'public._exportar_insumos_core(uuid,text,text[],text[],integer)']) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'exportar_por_tipo_acl: % ainda executavel por anon/authenticated', r.sig USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT unnest(ARRAY[
      'public.exportar_tecidos(text,text[],text[],integer)',
      'public.exportar_aviamentos(text,text,text[],text[],integer)',
      'public.exportar_insumos(text,text[],text[],integer)']) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'exportar_por_tipo_acl: wrapper % executavel por anon', r.sig USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
