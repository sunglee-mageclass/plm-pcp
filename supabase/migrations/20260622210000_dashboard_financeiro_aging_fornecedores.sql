-- Fase 6 (item 33): + aging de contas a pagar (snapshot por idade do vencimento)
-- e top fornecedores (por valor das parcelas no período) no dashboard Financeiro.
-- Estende o _core (lógica); o wrapper dashboard_financeiro (permissão) fica intacto.

CREATE OR REPLACE FUNCTION public._dashboard_financeiro_core(p_inicio date DEFAULT NULL::date, p_fim date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_investido numeric := 0; v_pago numeric := 0; v_pendente numeric := 0;
  v_chart jsonb; v_aging jsonb; v_top_forn jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  SELECT COALESCE(SUM(valor_real_total),0) INTO v_investido
  FROM ocs_tecido
  WHERE tenant_id = v_tenant AND status = 'recebido'
    AND (p_inicio IS NULL OR COALESCE(data_entrega, data_pedido) >= p_inicio)
    AND (p_fim    IS NULL OR COALESCE(data_entrega, data_pedido) <= p_fim);

  v_investido := v_investido + COALESCE((
    SELECT SUM(COALESCE(i.quantidade_recebida,0) * COALESCE(a.preco,0))
    FROM ocs_aviamento_itens i
    JOIN ocs_aviamento oc ON oc.id = i.oc_aviamento_id AND oc.tenant_id = v_tenant AND oc.status = 'recebido'
      AND (p_inicio IS NULL OR COALESCE(oc.data_entrega, oc.data_pedido) >= p_inicio)
      AND (p_fim    IS NULL OR COALESCE(oc.data_entrega, oc.data_pedido) <= p_fim)
    LEFT JOIN aviamentos a ON a.id = i.aviamento_id
  ), 0);

  SELECT
    COALESCE(SUM(valor) FILTER (WHERE status='pago' OR data_pagamento IS NOT NULL), 0),
    COALESCE(SUM(valor) FILTER (WHERE NOT(status='pago' OR data_pagamento IS NOT NULL)), 0)
  INTO v_pago, v_pendente
  FROM parcelas
  WHERE tenant_id = v_tenant
    AND (p_inicio IS NULL OR data_vencimento >= p_inicio)
    AND (p_fim    IS NULL OR data_vencimento <= p_fim);

  IF p_inicio IS NOT NULL AND p_fim IS NOT NULL THEN
    WITH gs AS (
      SELECT generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') AS d
    ),
    base AS (SELECT to_char(d,'YYYY-MM') AS k, to_char(d,'Mon/YY') AS mes FROM gs)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', COALESCE(t.total,0)) ORDER BY k), '[]'::jsonb)
    INTO v_chart
    FROM base
    LEFT JOIN (
      SELECT to_char(data_vencimento,'YYYY-MM') AS k, SUM(valor) AS total
      FROM parcelas
      WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
        AND data_vencimento >= date_trunc('month', p_inicio)
        AND data_vencimento <  date_trunc('month', p_fim) + interval '1 month'
      GROUP BY 1
    ) t USING (k);
  ELSE
    WITH meses AS (SELECT generate_series(0, 5) AS i),
    base AS (
      SELECT to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'YYYY-MM') AS k,
             to_char(date_trunc('month', current_date) + (i || ' month')::interval, 'Mon/YY') AS mes
      FROM meses
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('mes', mes, 'total', COALESCE(t.total,0)) ORDER BY k), '[]'::jsonb)
    INTO v_chart
    FROM base
    LEFT JOIN (
      SELECT to_char(data_vencimento,'YYYY-MM') AS k, SUM(valor) AS total
      FROM parcelas
      WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
        AND data_vencimento >= date_trunc('month', current_date)
        AND data_vencimento <  date_trunc('month', current_date) + interval '6 months'
      GROUP BY 1
    ) t USING (k);
  END IF;

  -- Aging das contas a pagar EM ABERTO (snapshot atual, por idade do vencimento).
  v_aging := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('faixa', faixa, 'total', total) ORDER BY ord)
    FROM (
      SELECT faixa, ord, SUM(valor) AS total FROM (
        SELECT valor,
          CASE WHEN data_vencimento < current_date THEN 'Vencido'
               WHEN data_vencimento <= current_date + 30 THEN '0–30 dias'
               WHEN data_vencimento <= current_date + 60 THEN '31–60 dias'
               WHEN data_vencimento <= current_date + 90 THEN '61–90 dias'
               ELSE '90+ dias' END AS faixa,
          CASE WHEN data_vencimento < current_date THEN 0
               WHEN data_vencimento <= current_date + 30 THEN 1
               WHEN data_vencimento <= current_date + 60 THEN 2
               WHEN data_vencimento <= current_date + 90 THEN 3
               ELSE 4 END AS ord
        FROM parcelas
        WHERE tenant_id = v_tenant AND NOT (status='pago' OR data_pagamento IS NOT NULL)
      ) x GROUP BY faixa, ord
    ) a
  ), '[]'::jsonb);

  -- Top fornecedores por valor das parcelas no período.
  v_top_forn := COALESCE((
    SELECT jsonb_agg(jsonb_build_object('nome', nome, 'total', total) ORDER BY total DESC)
    FROM (
      SELECT COALESCE(e.nome_fantasia, 'Sem fornecedor') AS nome, SUM(p.valor) AS total
      FROM parcelas p
      LEFT JOIN empresas e ON e.id = p.empresa_id
      WHERE p.tenant_id = v_tenant
        AND (p_inicio IS NULL OR p.data_vencimento >= p_inicio)
        AND (p_fim    IS NULL OR p.data_vencimento <= p_fim)
      GROUP BY 1
      ORDER BY total DESC
      LIMIT 8
    ) f
  ), '[]'::jsonb);

  RETURN jsonb_build_object(
    'investido', v_investido, 'pago', v_pago, 'pendente', v_pendente, 'chartData', v_chart,
    'aging', v_aging, 'topFornecedores', v_top_forn
  );
END;
$function$;
