-- Tela "Distribuição" — resumo automático da coleção + N tabelas de distribuição por loja.
--
-- 1) RPC `distribuicao_resumo(_colecao_id, _subcolecao)` — agrega os modelos da coleção/subcoleção
--    (demonstrativo): total de grade, grade por tamanho, % roupa×acessório, % por categoria, % por
--    linha, nº de repetições (versao>1). NÃO grava nada.
-- 2) Tabela `distribuicao_tabelas` — as N tabelas persistidas (grade-base + cores + peças/mês +
--    lojas jsonb estado-completo). RLS tenant-scoped.
-- 3) RPCs `salvar_distribuicao_tabela` / `excluir_distribuicao_tabela` — estado completo por save.
--
-- Segurança: invariante #9 (REVOKE dos 3 + GRANT authenticated), guardas auth/tenant/loja-inativa.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Tabela das N tabelas de distribuição (1 registro por tabela nomeável)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.distribuicao_tabelas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  colecao_id uuid REFERENCES public.colecoes(id) ON DELETE CASCADE,
  subcolecao text,                       -- NULL = coleção inteira
  nome text NOT NULL DEFAULT 'Nova tabela',
  ordem int NOT NULL DEFAULT 0,
  grade_base jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"34": 1, "36": 1, ...} proporção
  cores int NOT NULL DEFAULT 1,
  pecas_mes int NOT NULL DEFAULT 0,
  -- estado COMPLETO das linhas de loja: [{loja_id, base, markup, valor_ref}]
  --   valor_ref = valor médio digitado (só a loja-referência tem); as outras derivam por markup.
  lojas jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_distribuicao_tabelas_tenant_colecao
  ON public.distribuicao_tabelas (tenant_id, colecao_id);

-- tenant_id via trigger (nunca no INSERT do cliente)
DROP TRIGGER IF EXISTS set_tenant_id_distribuicao ON public.distribuicao_tabelas;
CREATE TRIGGER set_tenant_id_distribuicao
  BEFORE INSERT ON public.distribuicao_tabelas
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id();

ALTER TABLE public.distribuicao_tabelas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS distribuicao_tabelas_tenant ON public.distribuicao_tabelas;
CREATE POLICY distribuicao_tabelas_tenant ON public.distribuicao_tabelas
  FOR ALL USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- ---------------------------------------------------------------------------
-- 2) RPC de RESUMO — agrega os modelos da coleção/subcoleção (demonstrativo).
--    subcolecao NULL/'' = coleção inteira. Casa subcoleção por texto (m.subcolecao = _subcolecao).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.distribuicao_resumo(_colecao_id uuid, _subcolecao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
END $$;

REVOKE EXECUTE ON FUNCTION public.distribuicao_resumo(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.distribuicao_resumo(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPC salvar (upsert de UMA tabela; estado completo das lojas por save)
--    _dados = { id?, colecao_id, subcolecao?, nome, ordem, grade_base, cores, pecas_mes, lojas[] }
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_distribuicao_tabela(_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
END $$;

REVOKE EXECUTE ON FUNCTION public.salvar_distribuicao_tabela(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.salvar_distribuicao_tabela(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC excluir
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.excluir_distribuicao_tabela(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  DELETE FROM distribuicao_tabelas WHERE id = _id AND tenant_id = v_tenant;
END $$;

REVOKE EXECUTE ON FUNCTION public.excluir_distribuicao_tabela(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.excluir_distribuicao_tabela(uuid) TO authenticated;

COMMIT;
