-- Ajuste #2 (jun/2026): cada bloco de Serviço (Terceirizado) ganha "desconto total"
-- e "multa total" que ajustam o CUSTO TOTAL do bloco:
--   custo_bloco = preco_metro_unidade * quantidade_enviada - desconto_total + multa_total
-- Persistido em producao_terceirizados; refletido no custo de serviço do dashboard
-- (_dashboard_custos_core.servico_total). NÃO altera a divisão por grade (B3 pendente).

ALTER TABLE public.producao_terceirizados
  ADD COLUMN IF NOT EXISTS desconto_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multa_total    numeric NOT NULL DEFAULT 0;

-- 1) salvar_terceirizados: persistir desconto_total/multa_total (UPDATE + INSERT).
CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  b jsonb;
  v_id uuid;
  v_ids uuid[] := '{}';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(_blocos) = 'array' THEN
    FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
      IF NULLIF(b->>'id','') IS NOT NULL THEN
        UPDATE public.producao_terceirizados SET
          categoria_terceirizado_id = NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          interno = COALESCE((b->>'interno')::boolean, false),
          terceirizado_id = NULLIF(b->>'terceirizado_id','')::uuid,
          colaborador_id = NULLIF(b->>'colaborador_id','')::uuid,
          ativo = COALESCE((b->>'ativo')::boolean, true),
          preco_metro_unidade = NULLIF(b->>'preco_metro_unidade','')::numeric,
          quantidade_enviada = NULLIF(b->>'quantidade_enviada','')::int,
          quantidade_recebida = NULLIF(b->>'quantidade_recebida','')::int,
          quantidade_defeito = NULLIF(b->>'quantidade_defeito','')::int,
          desconto_total = COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0),
          multa_total = COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          data_enviado = NULLIF(b->>'data_enviado','')::date,
          data_prevista = NULLIF(b->>'data_prevista','')::date,
          data_entregue = NULLIF(b->>'data_entregue','')::date,
          observacao = b->>'observacao',
          aviamentos_enviados = COALESCE(b->'aviamentos_enviados', '[]'::jsonb),
          tecidos_enviados = COALESCE(b->'tecidos_enviados', '[]'::jsonb)
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_terceirizados (
          cad_id, categoria_terceirizado_id, interno, terceirizado_id, colaborador_id, ativo,
          preco_metro_unidade, quantidade_enviada, quantidade_recebida, quantidade_defeito,
          desconto_total, multa_total,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados
        ) VALUES (
          _cad_id,
          NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          COALESCE((b->>'interno')::boolean, false),
          NULLIF(b->>'terceirizado_id','')::uuid,
          NULLIF(b->>'colaborador_id','')::uuid,
          COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'preco_metro_unidade','')::numeric,
          NULLIF(b->>'quantidade_enviada','')::int,
          NULLIF(b->>'quantidade_recebida','')::int,
          NULLIF(b->>'quantidade_defeito','')::int,
          COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0),
          COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          NULLIF(b->>'data_enviado','')::date,
          NULLIF(b->>'data_prevista','')::date,
          NULLIF(b->>'data_entregue','')::date,
          b->>'observacao',
          COALESCE(b->'aviamentos_enviados', '[]'::jsonb),
          COALESCE(b->'tecidos_enviados', '[]'::jsonb)
        ) RETURNING id INTO v_id;
      END IF;
      v_ids := array_append(v_ids, v_id);
    END LOOP;
  END IF;

  DELETE FROM public.producao_terceirizados
   WHERE cad_id = _cad_id AND NOT (id = ANY(v_ids));

  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;

-- 2) _dashboard_custos_core: servico_total inclui - desconto_total + multa_total.
CREATE OR REPLACE FUNCTION public._dashboard_custos_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date, p_colecao text DEFAULT NULL::text, p_categoria uuid DEFAULT NULL::uuid, p_linha uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_rows jsonb; v_chart jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  WITH cad_conf AS (
    SELECT DISTINCT ON (c.modelo_id) c.modelo_id, c.id AS cad_id
    FROM cad c
    WHERE c.tenant_id = v_tenant AND c.enviado_corte
    ORDER BY c.modelo_id, c.data_enviado_corte DESC NULLS LAST
  ),
  mat AS (
    SELECT cc.modelo_id,
      COALESCE((SELECT SUM(CASE WHEN ct.custo_cad IS NOT NULL THEN ct.custo_cad
          ELSE COALESCE(ct.consumo_cad,0) * (1 + COALESCE(ct.loss_percent_cad,0)/100.0) * COALESCE(a.preco_por_metro,0) END)
        FROM cad_tecidos ct LEFT JOIN artigos a ON a.id = ct.artigo_id WHERE ct.cad_id = cc.cad_id), 0)
      + COALESCE((SELECT SUM(COALESCE(ca.consumo,0) * COALESCE(av.preco,0))
        FROM cad_aviamentos ca LEFT JOIN aviamentos av ON av.id = ca.aviamento_id WHERE ca.cad_id = cc.cad_id), 0) AS materials,
      COALESCE((SELECT SUM(COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)
            - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0))
        FROM producao_terceirizados pt WHERE pt.cad_id = cc.cad_id AND COALESCE(pt.interno,false) = false), 0) AS servico_total,
      COALESCE((SELECT SUM(COALESCE(g.grade_total_real, g.grade_total_planejada, 0)) FROM cad_grades g WHERE g.cad_id = cc.cad_id), 0) AS grade
    FROM cad_conf cc
  ),
  base AS (
    SELECT m.id, m.ref, m.nome, m.colecao, m.versao,
      EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id) AS confirmado,
      COALESCE(m.custo_peca_previsto, 0) AS previsto,
      CASE WHEN EXISTS(SELECT 1 FROM cad_conf cc WHERE cc.modelo_id = m.id)
        THEN COALESCE((SELECT materials + CASE WHEN grade > 0 THEN servico_total / grade ELSE 0 END
                       FROM mat WHERE mat.modelo_id = m.id), 0)
        ELSE COALESCE(m.custo_peca_previsto, 0)
      END AS real
    FROM modelos m
    WHERE m.tenant_id = v_tenant
      AND (p_colecao IS NULL OR m.colecao = p_colecao)
      AND (p_categoria IS NULL OR m.categoria_principal_id = p_categoria)
      AND (p_linha IS NULL OR m.linha_id = p_linha)
      AND public._modelo_no_periodo(m.mes_id, m.ano_id, p_inicio, p_fim)
  )
  SELECT
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'ref', ref, 'nome', nome, 'colecao', colecao, 'versao', versao, 'confirmado', confirmado,
        'previsto', previsto, 'real', real, 'diff', (real - previsto),
        'pct', CASE WHEN previsto > 0 THEN ((real - previsto)/previsto)*100 ELSE 0 END
      ) ORDER BY ref) FROM base), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('colecao', colecao, 'medio', medio))
              FROM (SELECT colecao, AVG(NULLIF(real,0)) AS medio FROM base WHERE colecao IS NOT NULL AND confirmado GROUP BY colecao) c), '[]'::jsonb)
  INTO v_rows, v_chart;

  RETURN jsonb_build_object(
    'rows', v_rows, 'chartData', v_chart,
    'filtros', jsonb_build_object(
      'categorias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM categorias_produto WHERE tenant_id=v_tenant), '[]'::jsonb),
      'linhas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'nome',nome) ORDER BY nome) FROM linhas WHERE tenant_id = v_tenant), '[]'::jsonb),
      'colecoes', COALESCE((SELECT jsonb_agg(DISTINCT colecao) FROM modelos WHERE tenant_id=v_tenant AND colecao IS NOT NULL AND colecao <> ''), '[]'::jsonb)
    )
  );
END;
$function$;
