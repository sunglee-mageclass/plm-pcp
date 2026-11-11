-- Exportar dados (Integracao > Exportar, 11/nov/2026): 3 RPCs NOVAS (objetos novos; nenhuma funcao existente e redefinida).
-- Desenho: docs/superpowers/specs/2026-11-11-exportar-dados-design.md. Plano: .superpowers/sdd/2026-11-11-exportar-dados/.
--
--   public._exportar_produtos_core(_tenant, _colecao, _subcolecao, _campos, _niveis, _limite) -> jsonb
--       (DEFINER; EXECUTE revogado de PUBLIC/anon/authenticated). Monta {colunas, total, niveis:{"1":[...],"2":[...],"3":[...]}}.
--   public.exportar_produtos(_colecao, _subcolecao, _campos, _niveis, _limite DEFAULT NULL) -> jsonb
--       (wrapper DEFINER: login + loja ativa + permissao de VER a Integracao pelo mesmo portao das RPCs da Integracao).
--   public.exportar_subcolecoes(_colecao) -> jsonb  ["R1","R2",...]  (so as subcolecoes daquela colecao; mesmo portao).
--
-- RECORTE = os modelos da loja (as 3 origens: interno, revenda, importado) SEM o filtro que a lista da Integracao aplica
-- aos reprovados: o reprovado ENTRA na exportacao (decisao do dono). Filtro: colecao (nome do OTB, senao o texto livre com
-- trim; tambem aceita o id da colecao em texto) e subcolecao (igualdade exata). Colecao vazia/NULL = sem filtro.
-- _limite = modo PREVIA: limita o numero de PRODUTOS (o pai e os filhos de cada produto vem completos); `total` e sempre o
-- numero de produtos do recorte inteiro (antes do limite). NULL = tudo.
--
-- NIVEIS (_niveis text[] com '1','2','3'): 1 = 1 linha por produto (pai). 2 = o pai seguido de 1 linha por variante de cor.
-- 3 = o pai seguido de 1 linha por SKU cor x tamanho (a mesma matriz do SKU: variante x tamanho com grade > 0). Produto sem
-- variante/grade sai so com o pai. Os campos cor_base/cor_apelido/tamanho sao vazios (null) na linha do pai; nas linhas
-- filhas os demais campos herdam o valor do pai, exceto ref_sku, que no nivel 3 e o SKU GRAVADO da linha (modelo_skus; null
-- se ainda nao gerado) e no nivel 2 herda a REF do pai (nao existe SKU por cor).
--
-- CAMPOS (_campos text[], chave -> fonte; a ordem pedida vai em `colunas`, as linhas sao objetos chave -> valor):
--   nome, ref_sku, preco_anterior, preco_venda, preco_atacado, preco_custo, peso, ncm, titulo, descricao, keywords, metatag,
--   comprimento, largura, altura, foto, colecao, categoria_tecido, linha, subcolecao, origem, grupo, categoria, subcategoria1,
--   subcategoria2, cor_base, cor_apelido, tamanho. Valores efetivos (como o retrato da Integracao): titulo e preco_anterior
--   vazios no card usam o automatico da versao anterior; preco_custo = real se o corte foi confirmado, senao o previsto (sem
--   mascara: o acesso a aba e o controle); numeros saem como numero JSON (<= 0 ou vazio = null). Taxonomia (grupo/categoria/
--   sub1/sub2) e colecao/linha/categoria_tecido sempre filtradas pela LOJA do modelo.
--
-- Erros (P0001, ASCII): exportar_sem_loja, exportar_campos_vazio, exportar_campo_invalido: <chave>, exportar_niveis_vazio,
-- exportar_nivel_invalido: <valor>, exportar_limite_invalido. Login/permissao: pelo portao da Integracao (42501).
-- Seguranca: SECURITY DEFINER + SET search_path TO 'public'; o _core recebe a loja por parametro e por isso NAO e chamavel
-- pelo cliente (REVOKE dos TRES); so o wrapper o chama, com a loja do usuario. Leitura apenas.
-- Trava: so catalogo (CREATE FUNCTION + GRANT/REVOKE). Nada em auth/storage/realtime. Idempotente (CREATE OR REPLACE).
-- Volta: supabase/rollback/20261122100000_exportar_dados_down.sql (DROP das 3 funcoes). Banco ANTES do site.
-- Aplicar fora de transacao de teste: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_n int;
BEGIN
  -- sobrecarga com outros argumentos deixaria a chamada por nome ambigua no PostgREST
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'exportar_produtos' AND p.pronargs <> 5;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'exportar_sobrecarga: % sobrecarga(s) de public.exportar_produtos com outros argumentos', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'exportar_subcolecoes' AND p.pronargs <> 1;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'exportar_sobrecarga: % sobrecarga(s) de public.exportar_subcolecoes com outros argumentos', v_n USING ERRCODE = 'P0001';
  END IF;
  -- dependencias lidas pelo _core
  IF to_regprocedure('public._integracao_exige(boolean)') IS NULL
     OR to_regprocedure('public._integracao_extras(uuid)') IS NULL
     OR to_regprocedure('public._integracao_num(numeric,integer)') IS NULL
     OR to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') IS NULL
     OR to_regprocedure('public._sku_tamanho_lado(text,text)') IS NULL
     OR to_regprocedure('public._modelo_automaticos(uuid)') IS NULL
     OR to_regprocedure('public._custo_unitario_modelos_core(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'exportar_dep: falta uma funcao da qual a exportacao depende' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._exportar_produtos_core(
  _tenant uuid, _colecao text, _subcolecao text, _campos text[], _niveis text[], _limite integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_catalogo constant text[] := ARRAY['nome', 'ref_sku', 'preco_anterior', 'preco_venda', 'preco_atacado', 'preco_custo',
    'peso', 'ncm', 'titulo', 'descricao', 'keywords', 'metatag', 'comprimento', 'largura', 'altura', 'foto', 'colecao',
    'categoria_tecido', 'linha', 'subcolecao', 'origem', 'grupo', 'categoria', 'subcategoria1', 'subcategoria2',
    'cor_base', 'cor_apelido', 'tamanho'];
  v_ruim text;
  v_campos text[];
  v_niveis text[];
  v_col text := nullif(btrim(coalesce(_colecao, '')), '');
  v_sub text := nullif(_subcolecao, '');
  v_n1 boolean;
  v_n2 boolean;
  v_n3 boolean;
  v_total integer;
  v_ids uuid[];
  v_custos jsonb := '{}'::jsonb;
  v_kw text;
  v_prefixo text;
  v_precisa_auto boolean;
  v_precisa_extras boolean;
  v_tem_cor boolean;
  v_tem_apelido boolean;
  v_tem_tam boolean;
  v_tem_ref boolean;
  r record;
  s record;
  c text;
  v_val jsonb;
  v_pai jsonb;
  v_fil jsonb;
  v_c jsonb;
  v_custo numeric;
  v_titulo_auto text;
  v_preco_auto numeric;
  v_extras jsonb;
  v_tipo text;
  v_tam text;
  v_var_atual uuid;
  v_l1 jsonb[] := '{}'::jsonb[];
  v_l2 jsonb[] := '{}'::jsonb[];
  v_l3 jsonb[] := '{}'::jsonb[];
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

  -- niveis: '1' | '2' | '3'
  IF _niveis IS NULL OR cardinality(_niveis) = 0 THEN
    RAISE EXCEPTION 'exportar_niveis_vazio' USING ERRCODE = 'P0001';
  END IF;
  SELECT x INTO v_ruim FROM unnest(_niveis) AS u(x) WHERE x IS NULL OR x NOT IN ('1', '2', '3') LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'exportar_nivel_invalido: %', coalesce(v_ruim, 'null') USING ERRCODE = 'P0001';
  END IF;
  v_niveis := ARRAY(SELECT DISTINCT u.x FROM unnest(_niveis) AS u(x) ORDER BY 1);
  v_n1 := '1' = ANY (v_niveis);
  v_n2 := '2' = ANY (v_niveis);
  v_n3 := '3' = ANY (v_niveis);

  IF _limite IS NOT NULL AND _limite < 1 THEN
    RAISE EXCEPTION 'exportar_limite_invalido' USING ERRCODE = 'P0001';
  END IF;

  -- RECORTE: todos os modelos da loja (as 3 origens), reprovados INCLUIDOS; colecao = nome do OTB senao o texto livre.
  SELECT count(*) INTO v_total
    FROM public.modelos m
    LEFT JOIN public.colecoes co ON co.id = m.colecao_id AND co.tenant_id = m.tenant_id
   WHERE m.tenant_id = _tenant
     AND (v_col IS NULL
          OR coalesce(co.nome::text, nullif(btrim(coalesce(m.colecao::text, '')), '')) = v_col
          OR m.colecao_id::text = lower(v_col))
     AND (v_sub IS NULL OR m.subcolecao = v_sub);

  v_ids := ARRAY(
    SELECT m.id
      FROM public.modelos m
      LEFT JOIN public.colecoes co ON co.id = m.colecao_id AND co.tenant_id = m.tenant_id
     WHERE m.tenant_id = _tenant
       AND (v_col IS NULL
            OR coalesce(co.nome::text, nullif(btrim(coalesce(m.colecao::text, '')), '')) = v_col
            OR m.colecao_id::text = lower(v_col))
       AND (v_sub IS NULL OR m.subcolecao = v_sub)
     ORDER BY m.nome, m.id
     LIMIT _limite);

  v_tem_ref := 'ref_sku' = ANY (v_campos);
  v_tem_cor := 'cor_base' = ANY (v_campos);
  v_tem_apelido := 'cor_apelido' = ANY (v_campos);
  v_tem_tam := 'tamanho' = ANY (v_campos);
  v_precisa_auto := v_campos && ARRAY['titulo', 'preco_anterior']::text[];
  v_precisa_extras := v_campos && ARRAY['colecao', 'categoria_tecido', 'linha']::text[];

  IF 'keywords' = ANY (v_campos) THEN
    SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  END IF;
  v_prefixo := _tenant::text || '/';

  -- custo: UMA chamada para todos os produtos do recorte (so com a coluna pedida; sem mascara de permissao)
  IF 'preco_custo' = ANY (v_campos) AND cardinality(v_ids) > 0 THEN
    v_custos := coalesce(public._custo_unitario_modelos_core(v_ids), '{}'::jsonb);
  END IF;

  FOR r IN
    SELECT m AS mo, gp.nome::text AS g_nome, cp.nome::text AS c_nome, s1.nome::text AS s1_nome, s2.nome::text AS s2_nome
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, n)
      JOIN public.modelos m ON m.id = u.id AND m.tenant_id = _tenant
      LEFT JOIN public.categorias_produto cp ON cp.id = m.categoria_principal_id AND cp.tenant_id = m.tenant_id
      LEFT JOIN public.grupos_produto gp ON gp.id = cp.grupo_id AND gp.tenant_id = m.tenant_id
      LEFT JOIN public.subcategorias1_produto s1 ON s1.id = m.subcategoria1_id AND s1.tenant_id = m.tenant_id
      LEFT JOIN public.subcategorias2_produto s2 ON s2.id = m.subcategoria2_id AND s2.tenant_id = m.tenant_id
     ORDER BY u.n
  LOOP
    v_c := v_custos -> (r.mo).id::text;
    v_custo := CASE WHEN coalesce((v_c ->> 'confirmado')::boolean, false) THEN (v_c ->> 'real')::numeric
                    ELSE (v_c ->> 'previsto')::numeric END;
    v_titulo_auto := NULL;
    v_preco_auto := NULL;
    IF v_precisa_auto THEN
      SELECT a.titulo_auto, a.preco_auto INTO v_titulo_auto, v_preco_auto FROM public._modelo_automaticos((r.mo).id) a;
    END IF;
    v_extras := CASE WHEN v_precisa_extras THEN public._integracao_extras((r.mo).id) ELSE NULL END;

    -- linha do PAI: os campos pedidos (cor/tamanho so existem nas linhas filhas)
    v_pai := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      v_val := CASE c
        WHEN 'nome' THEN to_jsonb(nullif(btrim((r.mo).nome::text), ''))
        WHEN 'ref_sku' THEN to_jsonb(nullif(btrim(coalesce((r.mo).ref::text, '')), ''))
        WHEN 'preco_anterior' THEN to_jsonb(public._integracao_num(coalesce((r.mo).preco_anterior, v_preco_auto), 2)::numeric)
        WHEN 'preco_venda' THEN to_jsonb(public._integracao_num((r.mo).preco_venda, 2)::numeric)
        WHEN 'preco_atacado' THEN to_jsonb(public._integracao_num((r.mo).preco_atacado, 2)::numeric)
        WHEN 'preco_custo' THEN to_jsonb(public._integracao_num(v_custo, 2)::numeric)
        WHEN 'peso' THEN to_jsonb(public._integracao_num((r.mo).peso_kg, 3)::numeric)
        WHEN 'ncm' THEN to_jsonb(nullif(btrim(coalesce((r.mo).ncm, '')), ''))
        WHEN 'titulo' THEN to_jsonb(coalesce(nullif(btrim(coalesce((r.mo).titulo_pagina, '')), ''), v_titulo_auto))
        WHEN 'descricao' THEN to_jsonb(nullif(btrim(coalesce((r.mo).descricao_produto, '')), ''))
        WHEN 'metatag' THEN to_jsonb(nullif(btrim(coalesce((r.mo).descricao_produto, '')), ''))
        WHEN 'keywords' THEN to_jsonb(nullif(btrim(coalesce(v_kw, '')), ''))
        WHEN 'comprimento' THEN to_jsonb(public._integracao_num((r.mo).comprimento_cm, NULL)::numeric)
        WHEN 'largura' THEN to_jsonb(public._integracao_num((r.mo).largura_cm, NULL)::numeric)
        WHEN 'altura' THEN to_jsonb(public._integracao_num((r.mo).altura_cm, NULL)::numeric)
        WHEN 'foto' THEN to_jsonb(nullif(array_to_string(
          ARRAY(SELECT p.x FROM unnest(coalesce((r.mo).fotos_modelo, '{}'::text[])) WITH ORDINALITY AS p(x, n)
                 WHERE starts_with(p.x, v_prefixo) AND p.x !~ '(^|/)\.{1,2}(/|$)' ORDER BY p.n), ' | '), ''))
        WHEN 'colecao' THEN to_jsonb(v_extras ->> 'colecao')
        WHEN 'categoria_tecido' THEN to_jsonb(v_extras ->> 'categoria_tecido')
        WHEN 'linha' THEN to_jsonb(v_extras ->> 'linha')
        WHEN 'subcolecao' THEN to_jsonb(nullif(btrim(coalesce((r.mo).subcolecao, '')), ''))
        WHEN 'origem' THEN to_jsonb(coalesce((r.mo).origem, 'interno'))
        WHEN 'grupo' THEN to_jsonb(nullif(btrim(coalesce(r.g_nome, '')), ''))
        WHEN 'categoria' THEN to_jsonb(nullif(btrim(coalesce(r.c_nome, '')), ''))
        WHEN 'subcategoria1' THEN to_jsonb(nullif(btrim(coalesce(r.s1_nome, '')), ''))
        WHEN 'subcategoria2' THEN to_jsonb(nullif(btrim(coalesce(r.s2_nome, '')), ''))
        ELSE NULL  -- cor_base / cor_apelido / tamanho: so nas linhas filhas
      END;
      v_pai := v_pai || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    END LOOP;

    IF v_n1 THEN v_l1 := v_l1 || v_pai; END IF;
    IF v_n2 THEN v_l2 := v_l2 || v_pai; END IF;
    IF v_n3 THEN v_l3 := v_l3 || v_pai; END IF;

    -- filhas: variante (cor) x tamanho com grade > 0 + SKU gravado, agrupadas por variante (a ordem da grade)
    IF v_n2 OR v_n3 THEN
      v_tipo := coalesce((r.mo).tamanho_tipo, 'letra');
      v_var_atual := NULL;
      FOR s IN
        SELECT k.variante_key, k.variante_ordem, k.cor_nome, k.apelido_nome, k.tamanho_key, k.tamanho_ordem, sk.sku AS sku_gravado
          FROM public._skus_calc_ref_tipo((r.mo).id, (r.mo).ref::text, v_tipo) k
          LEFT JOIN public.modelo_skus sk
            ON sk.modelo_id = (r.mo).id AND sk.tenant_id = (r.mo).tenant_id
           AND sk.variante_key = k.variante_key AND sk.tamanho_key = k.tamanho_key
         ORDER BY k.variante_ordem NULLS LAST, k.variante_key, k.tamanho_ordem NULLS LAST, k.tamanho_key
      LOOP
        v_fil := v_pai;
        IF v_tem_cor THEN v_fil := v_fil || jsonb_build_object('cor_base', coalesce(to_jsonb(s.cor_nome), 'null'::jsonb)); END IF;
        IF v_tem_apelido THEN v_fil := v_fil || jsonb_build_object('cor_apelido', coalesce(to_jsonb(s.apelido_nome), 'null'::jsonb)); END IF;
        -- nivel 2: 1 linha por variante de cor (na 1a vez que a variante aparece); tamanho fica vazio
        IF v_n2 AND v_var_atual IS DISTINCT FROM s.variante_key THEN
          v_l2 := v_l2 || v_fil;
        END IF;
        v_var_atual := s.variante_key;
        -- nivel 3: 1 linha por SKU cor x tamanho
        IF v_n3 THEN
          IF v_tem_tam THEN
            v_tam := nullif(coalesce(public._sku_tamanho_lado(s.tamanho_key, v_tipo), s.tamanho_key), '');
            v_fil := v_fil || jsonb_build_object('tamanho', coalesce(to_jsonb(v_tam), 'null'::jsonb));
          END IF;
          IF v_tem_ref THEN
            v_fil := v_fil || jsonb_build_object('ref_sku', coalesce(to_jsonb(nullif(btrim(coalesce(s.sku_gravado, '')), '')), 'null'::jsonb));
          END IF;
          v_l3 := v_l3 || v_fil;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF v_n1 THEN v_niv := v_niv || jsonb_build_object('1', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l1) AS x), '[]'::jsonb)); END IF;
  IF v_n2 THEN v_niv := v_niv || jsonb_build_object('2', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l2) AS x), '[]'::jsonb)); END IF;
  IF v_n3 THEN v_niv := v_niv || jsonb_build_object('3', coalesce((SELECT jsonb_agg(x) FROM unnest(v_l3) AS x), '[]'::jsonb)); END IF;

  RETURN jsonb_build_object('colunas', to_jsonb(v_campos), 'total', v_total, 'niveis', v_niv);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._exportar_produtos_core(uuid, text, text, text[], text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._exportar_produtos_core(uuid, text, text, text[], text[], integer) TO service_role;

CREATE OR REPLACE FUNCTION public.exportar_produtos(
  _colecao text, _subcolecao text, _campos text[], _niveis text[], _limite integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);  -- login + loja ativa + permissao de VER a Integracao
BEGIN
  RETURN public._exportar_produtos_core(v_tenant, _colecao, _subcolecao, _campos, _niveis, _limite);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.exportar_produtos(text, text, text[], text[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exportar_produtos(text, text, text[], text[], integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.exportar_subcolecoes(_colecao text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);  -- mesmo portao da exportacao
  v_col text := nullif(btrim(coalesce(_colecao, '')), '');
BEGIN
  -- subcolecoes DISTINTAS dos modelos da loja que pertencem a colecao pedida (mesmo casamento do recorte da exportacao)
  RETURN coalesce((
    SELECT jsonb_agg(DISTINCT m.subcolecao ORDER BY m.subcolecao)
      FROM public.modelos m
      LEFT JOIN public.colecoes co ON co.id = m.colecao_id AND co.tenant_id = m.tenant_id
     WHERE m.tenant_id = v_tenant
       AND nullif(btrim(coalesce(m.subcolecao, '')), '') IS NOT NULL
       AND (v_col IS NULL
            OR coalesce(co.nome::text, nullif(btrim(coalesce(m.colecao::text, '')), '')) = v_col
            OR m.colecao_id::text = lower(v_col))), '[]'::jsonb);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.exportar_subcolecoes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exportar_subcolecoes(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.exportar_produtos(text, text, text[], text[], integer) IS
  'Exportar dados (Integracao): produtos da loja por colecao/subcolecao, com campos e niveis (pai / cor / SKU); reprovados incluidos.';
COMMENT ON FUNCTION public.exportar_subcolecoes(text) IS
  'Exportar dados (Integracao): subcolecoes distintas de uma colecao da loja.';

-- pos-condicoes
DO $pos$
BEGIN
  IF has_function_privilege('anon', 'public._exportar_produtos_core(uuid,text,text,text[],text[],integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._exportar_produtos_core(uuid,text,text,text[],text[],integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exportar_pos: o _core esta executavel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.exportar_produtos(text,text,text[],text[],integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.exportar_subcolecoes(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exportar_pos: o wrapper esta executavel por anon' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
