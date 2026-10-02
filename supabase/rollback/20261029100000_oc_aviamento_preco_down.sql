-- INVERSO de supabase/migrations/20261029100000_oc_aviamento_preco.sql (achados LEVES L9: fin #8 P-206 A + est #5 P-208 A).
-- Devolve o texto de ANTES das 4 funcoes: gerar_parcelas_oc_aviamento, _recalcular_parcelas_core (= DEPOIS da R16),
-- _dashboard_financeiro_core e _salvar_oc_aviamento_core de 4 args (sem preco da compra, sem cor obrigatoria).
-- A COLUNA ocs_aviamento_itens.preco FICA (inerte: nenhuma funcao a le depois da volta; os precos digitados ficam guardados
-- e voltam a valer se a ida for reaplicada). Efeito: o valor das OCs de aviamento volta a seguir o preco do CADASTRO (o
-- proximo recalculo de uma OC recebida refaz as parcelas nao pagas pelo cadastro). Apagar a coluna e o
-- 20261029100000_oc_aviamento_preco_down_drop.sql, separado (PERDE os precos digitados).
-- Guarda: so roda se as 4 estao EXATAMENTE com o texto da ida (md5 de depois) e as dependencias seguem com o texto
-- conferido; outro -> P0001 e nada muda (rodar 2 vezes = a 2a recusa).
-- LIFO: SITE primeiro (a tela nova manda o preco e espera a recusa da cor; com o banco velho o preco seria ignorado).
-- O inverso da correcao unica 20261029110000 (se aplicada) roda ANTES deste. Este roda ANTES de
-- 20261026100000_parcela_complemento_down (R16), 20261002100000_oc_data_nota_entrada_down e dos inversos da release 9.
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.gerar_parcelas_oc_aviamento()', '11f384d54071402055205fd2ad66f2c6'),
      ('public._recalcular_parcelas_core(uuid,text)', 'cdd88638886087b9fd71a631be1035f1'),
      ('public._dashboard_financeiro_core(date,date)', 'c6069728c11a900047531eb4e1f5e920'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', 'cd78ec5bb7e2570db19f41c84584bfcc'),
      ('public.recalc_parcelas_aviamento_on_item()', 'a91921832ee054076b87954ef0daec35'),
      ('public.fn_colab_bump_oc_avi()', 'acab05e51f702c0912d0138d49a4c555')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l9 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l9 (volta): % nao esta com o texto esperado da ida (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _l9av_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public.gerar_parcelas_oc_aviamento()'), ('public._recalcular_parcelas_core(uuid,text)'), ('public._dashboard_financeiro_core(date,date)'), ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)')) v(s);

CREATE OR REPLACE FUNCTION public.gerar_parcelas_oc_aviamento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n_parcelas integer;
  v_valor_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_valor_ultima numeric(12,2);
  v_base_data date;
  v_dias integer[];
  v_vencimento date;
  v_valor_a_inserir numeric(12,2);
  i integer;
BEGIN
  IF NEW.status = 'recebido' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'recebido') THEN
    IF EXISTS (SELECT 1 FROM public.parcelas WHERE oc_aviamento_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco, 0)), 0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = NEW.id
      AND COALESCE(it.cancelado, false) = false;

    IF v_valor_total <= 0 THEN
      RETURN NEW;  -- OC sem valor não gera parcela.
    END IF;

    v_dias := ARRAY(
      SELECT t::int FROM regexp_split_to_table(COALESCE(NEW.prazo_pagamento, ''), '[^0-9]+') AS t
      WHERE t ~ '^[0-9]+$'
    );
    IF array_length(v_dias, 1) >= 1 THEN
      v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
    ELSE
      v_n_parcelas := GREATEST(COALESCE(NEW.quantidade_prazos, 1), 1);
    END IF;

    v_valor_parcela := ROUND(v_valor_total / v_n_parcelas, 2);
    v_valor_ultima := v_valor_total - (v_valor_parcela * (v_n_parcelas - 1));
    -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
    v_base_data := COALESCE(NEW.data_nota_entrada, NEW.data_entrega, CURRENT_DATE);

    FOR i IN 1..v_n_parcelas LOOP
      IF array_length(v_dias, 1) >= i THEN
        v_vencimento := v_base_data + v_dias[i];
      ELSE
        v_vencimento := v_base_data + (i * 30);
      END IF;
      v_valor_a_inserir := CASE WHEN i = v_n_parcelas THEN v_valor_ultima ELSE v_valor_parcela END;
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status)
      VALUES (NEW.tenant_id, 'aviamento', NEW.id, NEW.empresa_id, i, v_valor_a_inserir, v_vencimento, 'a_pagar');
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._recalcular_parcelas_core(_oc_id uuid, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_n_parcelas integer;
  v_valor_total numeric(12,2);
  v_valor_parcela numeric(12,2);
  v_base_data date;
  v_empresa uuid;
  -- Data-base do cronograma: `data_entrega` p/ tecido/aviamento, `data_pedido` p/
  -- p_acabado (nome do campo mantido pra não alterar o resto da função).
  v_data_entrega date;
  v_data_nota date;  -- Data da Nota de Entrada (24/set): quando preenchida, é a base do vencimento.
  v_quantidade_prazos integer;
  v_prazo_pagamento text;
  v_dias integer[];
  v_existentes_pagas integer := 0;
  v_pago_total numeric(12,2) := 0;
  v_deletadas integer := 0;
  v_criadas integer := 0;
  v_n_inserir integer := 0;
  v_restante_valor numeric(12,2);
  v_vencimento date;
  v_offset int;
  v_valor_a_inserir numeric(12,2);
  v_idx integer := 0;
  v_num_comp integer;
  i integer;
BEGIN
  -- Importado: as parcelas nascem das ETAPAS da OC (não de prazo-dias). "Recalcular" =
  -- re-rodar o gerador que já neta as pagas. Retorna cedo, sem a lógica de prazo abaixo.
  IF _tipo = 'p_importado' THEN
    PERFORM public._gerar_parcelas_importado(_oc_id);
    RETURN jsonb_build_object('ok', true, 'importado', true);
  END IF;
  IF _tipo = 'tecido' AND EXISTS (SELECT 1 FROM public.ocs_tecido WHERE id = _oc_id AND COALESCE(is_rolo,false)) THEN
    RETURN jsonb_build_object('ok', true, 'rolo', true);
  END IF;
  IF _tipo NOT IN ('tecido','aviamento','p_acabado') THEN
    RAISE EXCEPTION 'tipo deve ser tecido, aviamento ou p_acabado';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(_oc_id::text));

  IF _tipo = 'tecido' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1),
           prazo_pagamento, COALESCE(valor_real_total,0), data_nota_entrada
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_valor_total, v_data_nota
    FROM public.ocs_tecido WHERE id = _oc_id;
  ELSIF _tipo = 'aviamento' THEN
    SELECT tenant_id, empresa_id, data_entrega, COALESCE(quantidade_prazos,1), prazo_pagamento, data_nota_entrada
      INTO v_tenant, v_empresa, v_data_entrega, v_quantidade_prazos, v_prazo_pagamento, v_data_nota
    FROM public.ocs_aviamento WHERE id = _oc_id;

    SELECT COALESCE(SUM(COALESCE(it.quantidade_recebida, it.quantidade_pedida, 0) * COALESCE(a.preco,0)),0)
      INTO v_valor_total
    FROM public.ocs_aviamento_itens it
    LEFT JOIN public.aviamentos a ON a.id = it.aviamento_id
    WHERE it.oc_aviamento_id = _oc_id
      AND COALESCE(it.cancelado, false) = false;
  ELSE
    -- p_acabado: espelha gerar_parcelas_oc_p_acabado (base=data_pedido, total=valor_total_desconto).
    SELECT tenant_id, empresa_id, data_pedido, prazo_pagamento, COALESCE(valor_total_desconto,0), data_nota_entrada
      INTO v_tenant, v_empresa, v_data_entrega, v_prazo_pagamento, v_valor_total, v_data_nota
    FROM public.ocs_p_acabado WHERE id = _oc_id;
  END IF;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'OC não encontrada';
  END IF;

  v_dias := ARRAY(
    SELECT t::int FROM regexp_split_to_table(COALESCE(v_prazo_pagamento, ''), '[^0-9]+') AS t WHERE t ~ '^[0-9]+$'
  );
  IF array_length(v_dias, 1) >= 1 THEN
    v_n_parcelas := LEAST(array_length(v_dias, 1), 24);
  ELSE
    v_n_parcelas := GREATEST(v_quantidade_prazos, 1);
  END IF;

  SELECT COUNT(*), COALESCE(SUM(valor),0)
    INTO v_existentes_pagas, v_pago_total
  FROM public.parcelas
  WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
    AND (status = 'pago' OR data_pagamento IS NOT NULL);

  WITH del AS (
    DELETE FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
      AND status IS DISTINCT FROM 'pago' AND data_pagamento IS NULL
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deletadas FROM del;

  SELECT COUNT(*) INTO v_n_inserir
  FROM generate_series(1, v_n_parcelas) g(i)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.parcelas
    WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
      AND numero_parcela = g.i
  );

  v_restante_valor := v_valor_total - v_pago_total;

  -- [medios R16 RA1, P-187 A] COMPLEMENTO: saldo > 0 com TODAS as parcelas do prazo (1..n) pagas -> UMA parcela extra
  -- com a diferenca, nº = maior nº existente (>= n) + 1, vencendo junto com a ultima parcela do prazo (a data calculada
  -- da parcela n). Nao paga, ela e apagada no DELETE acima a cada recalculo e so volta se ainda houver saldo (saldo de
  -- volta a <= 0 -> some); paga, fica (e entra no pago). Data ajustada a mao: a guarda/reaplica por nº devolve.
  IF v_valor_total > 0 AND v_restante_valor > 0 AND v_n_inserir = 0 THEN
    SELECT GREATEST(v_n_parcelas, COALESCE(MAX(numero_parcela), 0)) + 1 INTO v_num_comp
      FROM public.parcelas
     WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id));
    v_base_data := COALESCE(v_data_nota, v_data_entrega, CURRENT_DATE);
    IF array_length(v_dias, 1) >= v_n_parcelas THEN v_vencimento := v_base_data + v_dias[v_n_parcelas]; v_offset := v_dias[v_n_parcelas];
    ELSE v_vencimento := v_base_data + (v_n_parcelas * 30); v_offset := NULL; END IF;
    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'tecido', _oc_id, v_empresa, v_num_comp, v_restante_valor, v_vencimento, 'a_pagar', v_offset);
    ELSIF _tipo = 'aviamento' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'aviamento', _oc_id, v_empresa, v_num_comp, v_restante_valor, v_vencimento, 'a_pagar', v_offset);
    ELSE
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_p_acabado_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'p_acabado', _oc_id, v_empresa, v_num_comp, v_restante_valor, v_vencimento, 'a_pagar', v_offset);
    END IF;
    RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
      'deletadas',v_deletadas,'criadas',1,'valor_total',v_valor_total,
      'restante',v_restante_valor,'complemento',v_num_comp,'fonte','prazo_pagamento');
  END IF;

  IF v_valor_total <= 0 OR v_restante_valor <= 0 OR v_n_inserir = 0 THEN
    RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
      'deletadas',v_deletadas,'criadas',0,'valor_total',v_valor_total,
      'restante',GREATEST(v_restante_valor,0),'fonte','prazo_pagamento');
  END IF;

  v_valor_parcela := ROUND(v_restante_valor / v_n_inserir, 2);
  -- Data da Nota de Entrada (24/set): com ela, o prazo conta a partir dela; sem ela, a base antiga (vencimento provisório).
  v_base_data := COALESCE(v_data_nota, v_data_entrega, CURRENT_DATE);

  FOR i IN 1..v_n_parcelas LOOP
    IF EXISTS (SELECT 1 FROM public.parcelas
      WHERE ((_tipo='tecido' AND oc_tecido_id = _oc_id) OR (_tipo='aviamento' AND oc_aviamento_id = _oc_id) OR (_tipo='p_acabado' AND oc_p_acabado_id = _oc_id))
        AND numero_parcela = i) THEN
      CONTINUE;
    END IF;
    v_idx := v_idx + 1;
    IF array_length(v_dias, 1) >= i THEN v_vencimento := v_base_data + v_dias[i]; v_offset := v_dias[i];
    ELSE v_vencimento := v_base_data + (i * 30); v_offset := NULL; END IF;
    v_valor_a_inserir := CASE WHEN v_idx = v_n_inserir
      THEN v_restante_valor - v_valor_parcela * (v_n_inserir - 1) ELSE v_valor_parcela END;
    IF _tipo = 'tecido' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_tecido_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'tecido', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar', v_offset);
    ELSIF _tipo = 'aviamento' THEN
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_aviamento_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'aviamento', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar', v_offset);
    ELSE
      INSERT INTO public.parcelas (tenant_id, tipo_oc, oc_p_acabado_id, empresa_id, numero_parcela, valor, data_vencimento, status, dias_offset)
      VALUES (v_tenant, 'p_acabado', _oc_id, v_empresa, i, v_valor_a_inserir, v_vencimento, 'a_pagar', v_offset);
    END IF;
    v_criadas := v_criadas + 1;
  END LOOP;

  RETURN jsonb_build_object('preservadas_pagas',v_existentes_pagas,'pago_total',v_pago_total,
    'deletadas',v_deletadas,'criadas',v_criadas,'valor_total',v_valor_total,
    'valor_parcela',v_valor_parcela,'fonte','prazo_pagamento');
END;
$function$;

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
    WHERE COALESCE(i.cancelado, false) = false
  ), 0);

  -- Pendente (a pagar): por VENCIMENTO no período.
  SELECT COALESCE(SUM(valor) FILTER (WHERE NOT(status='pago' OR data_pagamento IS NOT NULL)), 0)
  INTO v_pendente
  FROM parcelas
  WHERE tenant_id = v_tenant
    AND (p_inicio IS NULL OR data_vencimento >= p_inicio)
    AND (p_fim    IS NULL OR data_vencimento <= p_fim);

  -- Pago: por DATA DE PAGAMENTO no período (fluxo de caixa real, não vencimento).
  SELECT COALESCE(SUM(valor), 0)
  INTO v_pago
  FROM parcelas
  WHERE tenant_id = v_tenant AND (status='pago' OR data_pagamento IS NOT NULL)
    AND (p_inicio IS NULL OR data_pagamento >= p_inicio)
    AND (p_fim    IS NULL OR data_pagamento <= p_fim);

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

CREATE OR REPLACE FUNCTION public._salvar_oc_aviamento_core(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_oc_id uuid := _oc_id;
  v_status text := COALESCE(_oc->>'status', 'encomendado');
  v_recebido boolean := (_oc->>'status' = 'recebido');
  v_keep uuid[];
  v_num text;
  r jsonb;
BEGIN
  -- trava otimista (spec 2026-08-03) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev int;
    BEGIN
      SELECT rev INTO v_rev FROM public.ocs_aviamento
        WHERE id = _oc_id AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
        FOR UPDATE;
      IF v_rev IS DISTINCT FROM _rev_base THEN
        RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa'
          USING ERRCODE = 'P0409';
      END IF;
    END;
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- A3: itens não podem referenciar aviamento de outra loja (nem de outro fornecedor que
  -- não o da OC). Fecha item órfão/IDOR via payload forjado. (empresa_id da OC é validada
  -- pelo trigger enforce_empresa_tenant.)
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    JOIN public.aviamentos a ON a.id = (e->>'aviamento_id')::uuid
    WHERE e->>'aviamento_id' IS NOT NULL
      AND ( a.tenant_id IS DISTINCT FROM v_tenant
            OR ( (_oc->>'empresa_id') IS NOT NULL AND a.empresa_id IS NOT NULL
                 AND a.empresa_id IS DISTINCT FROM (_oc->>'empresa_id')::uuid ) )
  ) THEN
    RAISE EXCEPTION 'Aviamento de outra loja ou fornecedor não pode ser adicionado à OC.';
  END IF;

  -- Variante (se informada) tem de pertencer ao aviamento do MESMO item e à loja
  -- (espelha o vínculo cor-apelido de salvar_variantes_aviamento). LEFT JOIN p/ que
  -- id inexistente/forjado (va.id IS NULL) também caia no RAISE.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    LEFT JOIN public.variantes_aviamento va ON va.id = (e->>'variante_aviamento_id')::uuid
    WHERE NULLIF(e->>'variante_aviamento_id','') IS NOT NULL
      AND ( va.id IS NULL
            OR va.aviamento_id IS DISTINCT FROM (e->>'aviamento_id')::uuid
            OR va.tenant_id IS DISTINCT FROM v_tenant )
  ) THEN
    RAISE EXCEPTION 'Variante não pertence ao aviamento informado (ou é de outra loja).';
  END IF;

  IF v_oc_id IS NULL THEN
    -- INSERT: cria como 'encomendado' (trigger não gera parcela), itens, depois status final.
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_aviamento WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_aviamento
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, parcelas_recebimento, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int, 1), _oc->>'nf_url',
       COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb), 'encomendado', NULLIF(_oc->>'data_nota_entrada', '')::date)
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) e
    WHERE e->>'aviamento_id' IS NOT NULL;

    IF v_recebido THEN
      UPDATE public.ocs_aviamento SET status = 'recebido' WHERE id = v_oc_id;
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_aviamento
                   WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;

    -- diff de itens por id (preserva ids). keep = ids enviados.
    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL);
    DELETE FROM public.ocs_aviamento_itens
      WHERE oc_aviamento_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'aviamento_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_aviamento_itens SET
        aviamento_id = (r->>'aviamento_id')::uuid,
        variante_aviamento_id = NULLIF(r->>'variante_aviamento_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean, false)
      WHERE id = (r->>'id')::uuid AND oc_aviamento_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_aviamento_itens
      (oc_aviamento_id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado)
    SELECT v_oc_id, (e->>'aviamento_id')::uuid, NULLIF(e->>'variante_aviamento_id','')::uuid,
           (e->>'quantidade_pedida')::numeric,
           (e->>'quantidade_recebida')::numeric, COALESCE((e->>'cancelado')::boolean, false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'aviamento_id' IS NOT NULL;

    -- update da OC (dispara o trigger já com itens corretos)
    UPDATE public.ocs_aviamento SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int, 1),
      nf_url = _oc->>'nf_url',
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento', '[]'::jsonb),
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  -- Recalcula parcelas quando recebida (preserva pagas; o trigger não regenera se já existe).
  IF v_recebido THEN
    PERFORM public._recalcular_parcelas_core(v_oc_id, 'aviamento');
  END IF;

  RETURN v_oc_id;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.gerar_parcelas_oc_aviamento()', 'e98640190802afd6de9f82ac4ecb39c3'),
      ('public._recalcular_parcelas_core(uuid,text)', '3dcb59e6958c89d2d06901c50af390d7'),
      ('public._dashboard_financeiro_core(date,date)', '49b55c7be514483ced274ed05178a430'),
      ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)', '3c5a3d108d7f6e5a37319ceccb4406e2')) v(s, m) LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l9 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _l9av_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l9 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('public._recalcular_parcelas_core(uuid,text)'),
                                 ('public._dashboard_financeiro_core(date,date)'),
                                 ('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)'),
                                 ('public.gerar_parcelas_oc_aviamento()')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l9 (volta): % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
