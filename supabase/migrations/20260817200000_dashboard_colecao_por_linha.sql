-- Dashboard > Coleção: destrinche por LINHA (item 7).
-- A aba Coleção agrega os KPIs (Total / Em Planejamento / Em Desenvolvimento / Em Produção /
-- Lançados) sem a dimensão LINHA. Aqui adicionamos um campo NOVO `porLinha` no retorno de
-- _dashboard_colecao_core, quebrando os MESMOS 5 números por `modelos.linha_id`
-- (modelos sem linha => "Sem linha"). Menor risco: só ACRESCENTA uma chave ao jsonb —
-- nenhum consumidor existente (só dashboard.tsx) lê essa chave, então nada quebra.
--
-- As expressões de contagem por linha são IDÊNTICAS às dos KPIs globais (mesma ordem/
-- semântica do SELECT ... INTO original) — assim a soma das linhas reconcilia com os cards.
-- Respeita o filtro global da aba (período/coleção/estilista/linha), igual ao resto da RPC.
--
-- Segurança: inalterada. O wrapper dashboard_colecao (user_can_view('dashboard_colecao'))
-- e o REVOKE do _core continuam valendo — aqui só trocamos o corpo do _core.

CREATE OR REPLACE FUNCTION public._dashboard_colecao_core(
  p_inicio date DEFAULT NULL::date,
  p_fim date DEFAULT NULL::date,
  p_colecao text DEFAULT NULL::text,
  p_estilista uuid DEFAULT NULL::uuid,
  p_linha uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_total int := 0; v_planej int := 0; v_desenv int := 0; v_prod int := 0; v_lanc int := 0;
  v_reach_dev int := 0; v_reach_prod int := 0; v_pie jsonb;
  v_por_linha jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH mods AS (
    SELECT mo.id, mo.status_planejamento AS sp, COALESCE(mo.enviado_cad, false) AS ec,
           mo.categoria_principal_id AS cat,
           COALESCE(mo.lancado, false) AS lanc
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_colecao IS NULL OR mo.colecao = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
      AND (p_linha IS NULL OR mo.linha_id = p_linha)
      AND public._modelo_no_periodo(mo.mes_id, mo.ano_id, p_inicio, p_fim)
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE NOT ec AND sp IS DISTINCT FROM 'planejado'),
    count(*) FILTER (WHERE NOT ec AND sp = 'planejado'),
    count(*) FILTER (WHERE ec AND NOT lanc),
    count(*) FILTER (WHERE ec AND lanc),
    count(*) FILTER (WHERE ec OR sp = 'planejado'),
    count(*) FILTER (WHERE ec),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', nome, 'value', total))
              FROM (SELECT COALESCE(cp.nome,'Sem categoria') AS nome, count(*) AS total
                    FROM mods LEFT JOIN categorias_produto cp ON cp.id = mods.cat GROUP BY 1) x), '[]'::jsonb)
  INTO v_total, v_planej, v_desenv, v_prod, v_lanc, v_reach_dev, v_reach_prod, v_pie
  FROM mods;

  -- Destrinche por LINHA — MESMAS 5 métricas dos KPIs, por linha_id (NULL => "Sem linha").
  WITH mods AS (
    SELECT mo.linha_id AS linha_id, mo.status_planejamento AS sp,
           COALESCE(mo.enviado_cad, false) AS ec, COALESCE(mo.lancado, false) AS lanc
    FROM modelos mo
    WHERE mo.tenant_id = v_tenant
      AND (p_colecao IS NULL OR mo.colecao = p_colecao)
      AND (p_estilista IS NULL OR mo.estilista_id = p_estilista)
      AND (p_linha IS NULL OR mo.linha_id = p_linha)
      AND public._modelo_no_periodo(mo.mes_id, mo.ano_id, p_inicio, p_fim)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'linha_id', linha_id, 'nome', nome,
           'total', total, 'planejamento', planejamento, 'desenvolvimento', desenvolvimento,
           'producao', producao, 'lancados', lancados
         ) ORDER BY (linha_id IS NULL), nome), '[]'::jsonb)
  INTO v_por_linha
  FROM (
    SELECT mods.linha_id AS linha_id, COALESCE(l.nome,'Sem linha') AS nome,
      count(*) AS total,
      count(*) FILTER (WHERE NOT mods.ec AND mods.sp IS DISTINCT FROM 'planejado') AS planejamento,
      count(*) FILTER (WHERE NOT mods.ec AND mods.sp = 'planejado') AS desenvolvimento,
      count(*) FILTER (WHERE mods.ec AND NOT mods.lanc) AS producao,
      count(*) FILTER (WHERE mods.ec AND mods.lanc) AS lancados
    FROM mods LEFT JOIN linhas l ON l.id = mods.linha_id
    GROUP BY mods.linha_id, COALESCE(l.nome,'Sem linha')
  ) x;

  RETURN jsonb_build_object(
    'kpis', jsonb_build_object('total', v_total, 'planejamento', v_planej, 'desenvolvimento', v_desenv, 'producao', v_prod, 'lancados', v_lanc),
    'funnel', jsonb_build_array(
      jsonb_build_object('name','Total','value', v_total),
      jsonb_build_object('name','Desenvolvimento','value', v_reach_dev),
      jsonb_build_object('name','Produção','value', v_reach_prod),
      jsonb_build_object('name','Lançados','value', v_lanc)
    ),
    'pie', v_pie,
    'porLinha', v_por_linha,
    'filtros', jsonb_build_object(
      'estilistas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM colaboradores WHERE tenant_id = v_tenant AND tipo = 'estilista'), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id = v_tenant AND colecao IS NOT NULL AND colecao <> ''), '[]'::jsonb)
    )
  );
END;
$function$;
