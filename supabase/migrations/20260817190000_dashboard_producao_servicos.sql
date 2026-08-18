-- Dashboard > Produção: gráficos por CATEGORIA DE SERVIÇO (item 6).
-- Seção nova na aba Produção: dropdown de categoria de serviço + 2 gráficos.
--   (a) Em produção = blocos ATIVOS sem finalização (status <> 'finalizado') — FOTO ATUAL.
--   (b) Entregue    = blocos finalizados (status='finalizado'), série TEMPORAL por mês da data_entregue.
-- Cada gráfico tem 2 visões (toggle no front): por MODELO (contagem distinta) e por PEÇAS (Σ grade).
--
-- Formas (regra "a forma segue o trabalho do dado", docs de dataviz):
--   * Entregue TEM data_entregue  => barra por MÊS (série temporal, 1 matiz).
--   * Em produção NÃO tem data de conclusão => foto atual:
--       - visão geral (categoria=Todas): barras POR SERVIÇO (quem tem mais WIP agora);
--       - categoria específica: barras POR IDADE (dias desde o envio) — WIP envelhecendo,
--         escala sequencial (1 matiz claro->escuro) por urgência.
--
-- Peças por bloco = escalares do bloco (MESMA fonte que o resto do _dashboard_producao_core):
--   em produção => quantidade_enviada ; entregue => quantidade_recebida.
--
-- Filtro por NOME da categoria: categorias_terceirizado tem N ids por nome (ex.: 2 "PL",
--   4 "Corte" na Loja Teste, várias com blocos); filtrar por id fragmentaria o mesmo
--   serviço no dropdown/overview. Respeita o filtro global da aba (período/coleção/linha),
--   igual dashboard_producao.
--
-- Segurança (invariante #9): wrapper checa user_can_view('dashboard_producao'); _core com
--   EXECUTE revogado de PUBLIC, anon e authenticated (o _core recebe params e NÃO revalida o
--   chamador — só o wrapper autoriza).

CREATE OR REPLACE FUNCTION public._dashboard_producao_servicos_core(
  p_inicio date DEFAULT NULL::date,
  p_fim date DEFAULT NULL::date,
  p_colecao text DEFAULT NULL::text,
  p_linha uuid DEFAULT NULL::uuid,
  p_categoria text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_categorias jsonb; v_por_cat jsonb; v_por_idade jsonb; v_entregue jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  -- Dropdown: NOMES de categoria de serviço com >= 1 bloco (dedup por nome; evita
  -- duplicatas vazias). Ordena pela menor `ordem` do grupo, depois pelo nome.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', nome) ORDER BY ord NULLS LAST, nome), '[]'::jsonb)
  INTO v_categorias
  FROM (
    SELECT ct.nome AS nome, min(ct.ordem) AS ord
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true)
    GROUP BY ct.nome
  ) q;

  -- (a1) EM PRODUÇÃO por SERVIÇO (categoria) — foto atual. Usado quando categoria=Todas.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('categoria', categoria, 'modelos', modelos, 'pecas', pecas)
           ORDER BY pecas DESC, modelos DESC, categoria), '[]'::jsonb)
  INTO v_por_cat
  FROM (
    SELECT ct.nome AS categoria,
           count(DISTINCT c.modelo_id) AS modelos,
           COALESCE(SUM(COALESCE(t.quantidade_enviada,0)),0) AS pecas
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN modelos m ON m.id = c.modelo_id
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true) AND t.status IS DISTINCT FROM 'finalizado'
      AND (p_categoria IS NULL OR ct.nome = p_categoria)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
    GROUP BY ct.nome
  ) q;

  -- (a2) EM PRODUÇÃO por IDADE (dias desde o envio) — foto atual. Usado com categoria específica.
  WITH blocos AS (
    SELECT c.modelo_id,
           COALESCE(t.quantidade_enviada,0) AS pecas,
           CASE
             WHEN t.data_enviado IS NULL THEN 0
             WHEN (CURRENT_DATE - t.data_enviado) <= 7  THEN 1
             WHEN (CURRENT_DATE - t.data_enviado) <= 15 THEN 2
             WHEN (CURRENT_DATE - t.data_enviado) <= 30 THEN 3
             ELSE 4
           END AS faixa
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN modelos m ON m.id = c.modelo_id
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true) AND t.status IS DISTINCT FROM 'finalizado'
      AND (p_categoria IS NULL OR ct.nome = p_categoria)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  ),
  faixas(faixa, rotulo) AS (VALUES
    (0,'Sem envio'), (1,'0–7 dias'), (2,'8–15 dias'), (3,'16–30 dias'), (4,'+30 dias')
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('bucket', f.rotulo, 'ordem', f.faixa,
           'modelos', COALESCE(a.modelos,0), 'pecas', COALESCE(a.pecas,0)) ORDER BY f.faixa), '[]'::jsonb)
  INTO v_por_idade
  FROM faixas f
  LEFT JOIN (
    SELECT faixa, count(DISTINCT modelo_id) AS modelos, SUM(pecas) AS pecas
    FROM blocos GROUP BY faixa
  ) a ON a.faixa = f.faixa;

  -- (b) ENTREGUE ao longo do tempo (mês da data_entregue), status='finalizado'.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'modelos', modelos, 'pecas', pecas) ORDER BY k), '[]'::jsonb)
  INTO v_entregue
  FROM (
    SELECT to_char(t.data_entregue,'YYYY-MM') AS k, to_char(t.data_entregue,'Mon/YY') AS mes,
           count(DISTINCT c.modelo_id) AS modelos,
           COALESCE(SUM(COALESCE(t.quantidade_recebida,0)),0) AS pecas
    FROM producao_terceirizados t
      JOIN cad c ON c.id = t.cad_id AND c.tenant_id = v_tenant
      JOIN modelos m ON m.id = c.modelo_id
      JOIN categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
    WHERE COALESCE(t.ativo, true) AND t.status = 'finalizado' AND t.data_entregue IS NOT NULL
      AND (p_categoria IS NULL OR ct.nome = p_categoria)
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND (p_inicio IS NULL OR t.data_entregue >= p_inicio)
      AND (p_fim IS NULL OR t.data_entregue <= p_fim)
    GROUP BY 1, 2
  ) q;

  RETURN jsonb_build_object(
    'categorias', v_categorias,
    'emProducaoPorCategoria', v_por_cat,
    'emProducaoPorIdade', v_por_idade,
    'entreguePorMes', v_entregue
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.dashboard_producao_servicos(
  p_inicio date DEFAULT NULL::date,
  p_fim date DEFAULT NULL::date,
  p_colecao text DEFAULT NULL::text,
  p_linha uuid DEFAULT NULL::uuid,
  p_categoria text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.user_can_view('dashboard_producao') THEN
    RAISE EXCEPTION 'Sem permissão para dashboard_producao' USING ERRCODE='42501';
  END IF;
  RETURN public._dashboard_producao_servicos_core(p_inicio, p_fim, p_colecao, p_linha, p_categoria);
END;
$function$;

-- Invariante #9: revogar dos TRÊS (PUBLIC + anon + authenticated herdam de PUBLIC).
REVOKE EXECUTE ON FUNCTION public._dashboard_producao_servicos_core(date,date,text,uuid,text) FROM PUBLIC, anon, authenticated;
