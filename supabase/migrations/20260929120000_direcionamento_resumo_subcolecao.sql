-- Resumo do planejado × direcionado por subcoleção, p/ a tira no topo do sheet de Direcionamento.
-- Retorna:
--  • direcionados = nº de MODELOS da subcoleção com cad.direcionamento_status='separado'.
--  • planejado    = Σ da coluna TOTAL das tabelas de Distribuição da subcoleção (unidade = MODELOS).
--  • lojas[]      = breakdown POR LOJA × TAMANHO (o "como foi planejado"): nome, grade por tamanho,
--                   total. Agrega TODAS as tabelas da subcoleção (soma por loja×tamanho).
--  • tamanhos[]   = ordem das colunas (tenant_config.tamanhos_grade).
--
-- A grade por loja/tamanho = Σ_tabelas round( grade_base[tam] × base_loja ) — espelha
-- src/lib/distribuicao.ts (gradeDaLoja/totalGrade). Só considera as tabelas da subcoleção EXATA
-- (NÃO as de "coleção inteira"/subcolecao NULL — decisão do dono: o número tem de bater com o que
-- a tela Distribuição mostra ao selecionar a subcoleção). Cores/Peças-Mês são ignorados.
--
-- Recebe _modelo_id (o modelo aberto no sheet) e deriva coleção/subcoleção dele. A tira só mostra
-- "X/Y" + tabela quando o módulo distribuicao está ligado E planejado>0 (o front decide).
-- Molde de segurança: distribuicao_resumo (20260922120000). REVOKE dos 3 (invariante #9).

CREATE OR REPLACE FUNCTION public.direcionamento_resumo_subcolecao(_modelo_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
END $$;

REVOKE EXECUTE ON FUNCTION public.direcionamento_resumo_subcolecao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.direcionamento_resumo_subcolecao(uuid) TO authenticated;
