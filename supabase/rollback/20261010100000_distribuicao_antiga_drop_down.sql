-- INVERSO de 20261010100000_distribuicao_antiga_drop.sql -- RECRIA a Distribuicao antiga (SO estrutura + 4 RPCs).
-- Tabela public.distribuicao_tabelas exatamente como na copia (pg_dump --schema-only de 29/set: colunas, defaults, pkey,
-- 2 FKs, indice, gatilho set_tenant_id_distribuicao, RLS + policy distribuicao_tabelas_tenant, dono, GRANTs) e as 4
-- funcoes BYTE A BYTE (pg_get_functiondef da copia; conferidas por md5 na pos-condicao). Os textos das funcoes tem
-- acento (sao os originais) -- por isso o SET client_encoding ANTES do BEGIN.
-- DADOS: NAO voltam aqui. Vem do dump que o kit fez antes da ida (savepoints/pre-dist-parte2/: dados-*.sql aplicado pelo
-- volta-dist-parte2.sh, ou pg_restore --data-only do .dump).
-- LIFO: o inverso da Distribuicao nova (20261006100000_down) EXIGE esta tabela -- rode ESTE primeiro, se um dia precisar.
-- Travas: CREATE/DROP POLICY (hook supautils.policy_grants) segura AccessExclusive em tabelas de auth/storage/realtime
-- ate o COMMIT -- por isso a DDL de policy vem POR ULTIMO (logo antes da pos-condicao e do COMMIT); as FKs pegam
-- tenants/colecoes; lock_timeout curto e transacao curta. Idempotente (IF NOT EXISTS / OR REPLACE).
-- Mensagens de RAISE so ASCII. NUNCA \i dentro de BEGIN...ROLLBACK.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE v_n int;
BEGIN
  IF to_regclass('public.distribuicao_tabelas') IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'distribuicao_tabelas';
    IF v_n <> 12 THEN
      RAISE EXCEPTION 'distribuicao_antiga_drop (volta): distribuicao_tabelas ja existe com % colunas (esperado 12) - PARE', v_n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $guarda$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tabela (pg_dump --schema-only da copia; constraints inline p/ ficar idempotente -- mesmo catalogo)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.distribuicao_tabelas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    colecao_id uuid,
    subcolecao text,
    nome text DEFAULT 'Nova tabela'::text NOT NULL,
    ordem integer DEFAULT 0 NOT NULL,
    grade_base jsonb DEFAULT '{}'::jsonb NOT NULL,
    cores integer DEFAULT 1 NOT NULL,
    pecas_mes integer DEFAULT 0 NOT NULL,
    lojas jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT distribuicao_tabelas_pkey PRIMARY KEY (id),
    CONSTRAINT distribuicao_tabelas_colecao_id_fkey FOREIGN KEY (colecao_id) REFERENCES public.colecoes(id) ON DELETE CASCADE,
    CONSTRAINT distribuicao_tabelas_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

ALTER TABLE public.distribuicao_tabelas OWNER TO postgres;

CREATE INDEX IF NOT EXISTS idx_distribuicao_tabelas_tenant_colecao ON public.distribuicao_tabelas USING btree (tenant_id, colecao_id);

DROP TRIGGER IF EXISTS set_tenant_id_distribuicao ON public.distribuicao_tabelas;
CREATE TRIGGER set_tenant_id_distribuicao BEFORE INSERT ON public.distribuicao_tabelas FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

ALTER TABLE public.distribuicao_tabelas ENABLE ROW LEVEL SECURITY;

GRANT ALL ON TABLE public.distribuicao_tabelas TO anon;
GRANT ALL ON TABLE public.distribuicao_tabelas TO authenticated;
GRANT ALL ON TABLE public.distribuicao_tabelas TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 4 RPCs -- texto de pg_get_functiondef da copia (byte a byte). ACL final = {postgres, service_role, authenticated}
-- (invariante #9: PUBLIC e anon revogados).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.distribuicao_resumo(_colecao_id uuid, _subcolecao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_sub text := NULLIF(btrim(_subcolecao), '');
  v_total_grade bigint := 0;
  v_n_modelos bigint := 0;
  v_repeticoes bigint := 0;
  v_grade_por_tam jsonb := '{}'::jsonb;
  v_roupa bigint := 0;
  v_acess bigint := 0;
  v_por_categoria jsonb := '[]'::jsonb;
  v_por_linha jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING errcode = '42501';
  END IF;

  -- nº de modelos + repetições (versao>1)
  SELECT count(*), count(*) FILTER (WHERE m.versao > 1)
  INTO v_n_modelos, v_repeticoes
  FROM modelos m
  WHERE m.tenant_id = v_tenant AND m.colecao_id = _colecao_id
    AND (v_sub IS NULL OR m.subcolecao = v_sub);

  -- grade por tamanho: soma o jsonb de todas as variantes de todos os modelos.
  SELECT coalesce(jsonb_object_agg(tam, qtd), '{}'::jsonb) INTO v_grade_por_tam
  FROM (
    SELECT g.key AS tam, sum((g.value)::int) AS qtd
    FROM modelo_grades mg
    JOIN modelos m ON m.id = mg.modelo_id
    CROSS JOIN LATERAL jsonb_each_text(mg.grades) AS g(key, value)
    WHERE m.tenant_id = v_tenant AND m.colecao_id = _colecao_id
      AND (v_sub IS NULL OR m.subcolecao = v_sub)
      AND g.value ~ '^[0-9]+$'
    GROUP BY g.key
  ) t;

  -- ⚠️ total_grade = Σ da MESMA fonte jsonb (não `grade_total`, que pode divergir do jsonb em dado
  --    sujo pré-existente — achado da revisão). Garante que "Total de grade" = Σ "Grade por tamanho".
  SELECT coalesce(sum((v.value)::bigint), 0) INTO v_total_grade
  FROM jsonb_each_text(v_grade_por_tam) v;

  -- roupa × acessório (por nº de modelos): grupo do modelo via categoria_principal → grupo_id
  SELECT
    count(*) FILTER (WHERE NOT public._grupo_eh_acessorio(cp.grupo_id)),
    count(*) FILTER (WHERE public._grupo_eh_acessorio(cp.grupo_id))
  INTO v_roupa, v_acess
  FROM modelos m
  LEFT JOIN categorias_produto cp ON cp.id = m.categoria_principal_id
  WHERE m.tenant_id = v_tenant AND m.colecao_id = _colecao_id
    AND (v_sub IS NULL OR m.subcolecao = v_sub);

  -- % por categoria (nome da categoria_principal), só roupa
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd) ORDER BY qtd DESC), '[]'::jsonb)
  INTO v_por_categoria
  FROM (
    SELECT coalesce(cp.nome, 'Sem categoria') AS nome, count(*) AS qtd
    FROM modelos m
    LEFT JOIN categorias_produto cp ON cp.id = m.categoria_principal_id
    WHERE m.tenant_id = v_tenant AND m.colecao_id = _colecao_id
      AND (v_sub IS NULL OR m.subcolecao = v_sub)
      AND NOT public._grupo_eh_acessorio(cp.grupo_id)
    GROUP BY cp.nome
  ) c;

  -- % por linha
  SELECT coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'qtd', qtd) ORDER BY qtd DESC), '[]'::jsonb)
  INTO v_por_linha
  FROM (
    SELECT coalesce(l.nome, 'Sem linha') AS nome, count(*) AS qtd
    FROM modelos m
    LEFT JOIN linhas l ON l.id = m.linha_id
    WHERE m.tenant_id = v_tenant AND m.colecao_id = _colecao_id
      AND (v_sub IS NULL OR m.subcolecao = v_sub)
    GROUP BY l.nome
  ) x;

  RETURN jsonb_build_object(
    'n_modelos', v_n_modelos,
    'total_grade', v_total_grade,
    'repeticoes', v_repeticoes,
    'grade_por_tamanho', v_grade_por_tam,
    'roupa', v_roupa,
    'acessorio', v_acess,
    'por_categoria', v_por_categoria,
    'por_linha', v_por_linha
  );
END $function$
;

REVOKE ALL ON FUNCTION public.distribuicao_resumo(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.distribuicao_resumo(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.distribuicao_resumo(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.salvar_distribuicao_tabela(_dados jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_id uuid;
  v_colecao uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING errcode = '42501';
  END IF;

  v_colecao := NULLIF(_dados->>'colecao_id','')::uuid;
  -- IDOR: coleção tem de ser da loja.
  IF v_colecao IS NOT NULL AND NOT EXISTS (SELECT 1 FROM colecoes c WHERE c.id = v_colecao AND c.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Coleção não pertence à loja.' USING errcode = 'P0001';
  END IF;

  v_id := NULLIF(_dados->>'id','')::uuid;
  IF v_id IS NULL THEN
    INSERT INTO distribuicao_tabelas (colecao_id, subcolecao, nome, ordem, grade_base, cores, pecas_mes, lojas)
    VALUES (
      v_colecao,
      NULLIF(_dados->>'subcolecao',''),
      COALESCE(NULLIF(_dados->>'nome',''), 'Nova tabela'),
      COALESCE(NULLIF(_dados->>'ordem','')::int, 0),
      COALESCE(_dados->'grade_base', '{}'::jsonb),
      COALESCE(NULLIF(_dados->>'cores','')::int, 1),
      COALESCE(NULLIF(_dados->>'pecas_mes','')::int, 0),
      COALESCE(_dados->'lojas', '[]'::jsonb)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE distribuicao_tabelas SET
      colecao_id = v_colecao,
      subcolecao = NULLIF(_dados->>'subcolecao',''),
      nome       = COALESCE(NULLIF(_dados->>'nome',''), nome),
      ordem      = COALESCE(NULLIF(_dados->>'ordem','')::int, ordem),
      grade_base = COALESCE(_dados->'grade_base', grade_base),
      cores      = COALESCE(NULLIF(_dados->>'cores','')::int, cores),
      pecas_mes  = COALESCE(NULLIF(_dados->>'pecas_mes','')::int, pecas_mes),
      lojas      = COALESCE(_dados->'lojas', lojas),
      updated_at = now()
    WHERE id = v_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tabela não encontrada.' USING errcode = 'P0001'; END IF;
  END IF;

  RETURN v_id;
END $function$
;

REVOKE ALL ON FUNCTION public.salvar_distribuicao_tabela(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_distribuicao_tabela(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.salvar_distribuicao_tabela(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.excluir_distribuicao_tabela(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  DELETE FROM distribuicao_tabelas WHERE id = _id AND tenant_id = v_tenant;
END $function$
;

REVOKE ALL ON FUNCTION public.excluir_distribuicao_tabela(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.excluir_distribuicao_tabela(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.excluir_distribuicao_tabela(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.direcionamento_resumo_subcolecao(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_colecao text;
  v_colecao_id uuid;
  v_subcolecao text;
  v_direcionados bigint := 0;
  v_planejado numeric := 0;
  v_tamanhos jsonb := '[]'::jsonb;
  v_lojas jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING errcode = '42501';
  END IF;

  -- Modelo do sheet: tem de ser da loja (IDOR). Deriva coleção/subcoleção (texto) + colecao_id.
  SELECT NULLIF(btrim(m.colecao), ''), m.colecao_id, NULLIF(btrim(m.subcolecao), '')
    INTO v_colecao, v_colecao_id, v_subcolecao
  FROM modelos m
  WHERE m.id = _modelo_id AND m.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado' USING errcode = 'P0001';
  END IF;

  -- Resolve colecao_id quando o modelo só tem a coleção-texto (poucos casos legados).
  IF v_colecao_id IS NULL AND v_colecao IS NOT NULL THEN
    SELECT c.id INTO v_colecao_id
    FROM colecoes c
    WHERE c.tenant_id = v_tenant
      AND public._import_nome_norm(c.nome) = public._import_nome_norm(v_colecao)
    ORDER BY c.created_at LIMIT 1;
  END IF;

  -- direcionados = modelos da MESMA coleção+subcoleção (texto) já separados.
  SELECT count(DISTINCT m2.id)
    INTO v_direcionados
  FROM modelos m2
  JOIN cad c ON c.modelo_id = m2.id
  WHERE m2.tenant_id = v_tenant
    AND NULLIF(btrim(m2.colecao), '')    IS NOT DISTINCT FROM v_colecao
    AND NULLIF(btrim(m2.subcolecao), '') IS NOT DISTINCT FROM v_subcolecao
    AND c.direcionamento_status = 'separado';

  -- ordem das colunas de tamanho (mesma da grade da loja).
  SELECT COALESCE(tamanhos_grade, '["34|PPP","36|PP","38|P","40|M","42|G","44|GG"]'::jsonb)
    INTO v_tamanhos
  FROM tenant_config WHERE tenant_id = v_tenant;
  v_tamanhos := COALESCE(v_tamanhos, '["34|PPP","36|PP","38|P","40|M","42|G","44|GG"]'::jsonb);

  -- planejado por LOJA × TAMANHO: para cada linha de loja de cada tabela da subcoleção, expande a
  -- grade da loja (round(proporção × base) por tamanho) e agrega por (loja, tamanho). Só as tabelas
  -- da subcoleção EXATA (sem as de coleção inteira). Resolve o nome da loja em lojas_direcionamento.
  IF v_colecao_id IS NOT NULL THEN
    WITH cel AS (
      SELECT
        (loja->>'loja_id')::uuid AS loja_id,
        kv.key                   AS tam,
        round( (kv.value)::numeric * COALESCE((loja->>'base'), '0')::numeric ) AS qtd
      FROM distribuicao_tabelas dt
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(dt.lojas, '[]'::jsonb)) loja
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(dt.grade_base, '{}'::jsonb)) kv
      WHERE dt.tenant_id = v_tenant
        AND dt.colecao_id = v_colecao_id
        AND NULLIF(btrim(dt.subcolecao), '') IS NOT DISTINCT FROM v_subcolecao
        -- só os tamanhos da grade da loja (v_tamanhos): garante que a soma das COLUNAS exibidas no
        -- front feche com o total/planejado; um tamanho "rogue" no grade_base (fora da config) não
        -- entra no número (senão apareceria no total mas não teria coluna na tira).
        AND v_tamanhos ? kv.key
    ),
    por_loja_tam AS (  -- soma por loja×tamanho (várias tabelas somam)
      SELECT loja_id, tam, SUM(qtd) AS qtd FROM cel GROUP BY loja_id, tam
    ),
    por_loja AS (      -- monta {grade, total} por loja + nome + ordem
      SELECT
        p.loja_id,
        COALESCE(ld.nome, 'Loja') AS nome,
        COALESCE(ld.ordem, 999)   AS ordem,
        jsonb_object_agg(p.tam, p.qtd)          AS grade,
        SUM(p.qtd)                              AS total
      FROM por_loja_tam p
      LEFT JOIN lojas_direcionamento ld ON ld.id = p.loja_id AND ld.tenant_id = v_tenant
      GROUP BY p.loja_id, ld.nome, ld.ordem
    )
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object('nome', nome, 'grade', grade, 'total', total) ORDER BY ordem, nome), '[]'::jsonb),
      COALESCE(SUM(total), 0)
    INTO v_lojas, v_planejado
    FROM por_loja;
  END IF;

  RETURN jsonb_build_object(
    'direcionados', v_direcionados,
    'planejado', v_planejado::bigint,
    'colecao', v_colecao,
    'subcolecao', v_subcolecao,
    'tamanhos', v_tamanhos,
    'lojas', v_lojas
  );
END $function$
;

REVOKE ALL ON FUNCTION public.direcionamento_resumo_subcolecao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.direcionamento_resumo_subcolecao(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.direcionamento_resumo_subcolecao(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';  -- entregue so no COMMIT; vem antes da policy p/ nao alongar a trava

-- ---------------------------------------------------------------------------------------------------------------
-- Policy POR ULTIMO (DDL de policy trava auth/storage/realtime ate o COMMIT -- o menor tempo possivel).
-- ---------------------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS distribuicao_tabelas_tenant ON public.distribuicao_tabelas;
CREATE POLICY distribuicao_tabelas_tenant ON public.distribuicao_tabelas USING ((tenant_id = public.get_user_tenant_id())) WITH CHECK ((tenant_id = public.get_user_tenant_id()));

-- ---------------------------------------------------------------------------------------------------------------
-- Pos-condicao: md5 das 4 = copia; tabela com 12 colunas, policy, gatilho, indice e RLS. Divergiu = desfaz TUDO.
-- ---------------------------------------------------------------------------------------------------------------
DO $pos$
DECLARE
  v_md5 text;
  v_n int;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.distribuicao_resumo(uuid,text)')));
  IF v_md5 IS DISTINCT FROM 'dc8b90c474387d51910a596a1c6f0878' THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - distribuicao_resumo md5 % - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.distribuicao_resumo(uuid,text)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.distribuicao_resumo(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - ACL de distribuicao_resumo - desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.salvar_distribuicao_tabela(jsonb)')));
  IF v_md5 IS DISTINCT FROM '0227b0fa822e33cec2744c202e219cd8' THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - salvar_distribuicao_tabela md5 % - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.salvar_distribuicao_tabela(jsonb)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.salvar_distribuicao_tabela(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - ACL de salvar_distribuicao_tabela - desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.excluir_distribuicao_tabela(uuid)')));
  IF v_md5 IS DISTINCT FROM 'ee38685a948237aef94baddcab386924' THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - excluir_distribuicao_tabela md5 % - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.excluir_distribuicao_tabela(uuid)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.excluir_distribuicao_tabela(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - ACL de excluir_distribuicao_tabela - desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.direcionamento_resumo_subcolecao(uuid)')));
  IF v_md5 IS DISTINCT FROM 'd431e4edcb42308aadd558169d465195' THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - direcionamento_resumo_subcolecao md5 % - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.direcionamento_resumo_subcolecao(uuid)', 'EXECUTE') OR NOT has_function_privilege('authenticated', 'public.direcionamento_resumo_subcolecao(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - ACL de direcionamento_resumo_subcolecao - desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'distribuicao_tabelas';
  IF v_n <> 12
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'public.distribuicao_tabelas'::regclass AND polname = 'distribuicao_tabelas_tenant')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.distribuicao_tabelas'::regclass AND tgname = 'set_tenant_id_distribuicao')
     OR to_regclass('public.idx_distribuicao_tabelas_tenant_colecao') IS NULL
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.distribuicao_tabelas'::regclass) THEN
    RAISE EXCEPTION 'distribuicao_antiga_drop (volta): pos-condicao falhou - estrutura da tabela - desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'distribuicao_antiga_drop (volta): OK - tabela (vazia se era nova) e 4 RPCs recriadas';
END $pos$;

COMMIT;
