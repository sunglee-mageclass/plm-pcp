-- Serviços (terceirizados) — correções do review do time (cirúrgico completo).

-- [#5] auto_status_terceirizado: 'finalizado' só quando VOLTOU peça (alinha ao
-- blocoFinalizado da tela). Antes bastava data_entregue → o status CRU enganava
-- ERP/dashboards (finalizado antes de receber).
CREATE OR REPLACE FUNCTION public.auto_status_terceirizado()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(NEW.quantidade_enviada,0) > 0
     AND (COALESCE(NEW.quantidade_recebida,0) > 0 OR COALESCE(NEW.quantidade_defeito,0) > 0) THEN
    NEW.status := 'finalizado';
  ELSIF NEW.data_enviado IS NOT NULL OR COALESCE(NEW.quantidade_enviada,0) > 0 THEN
    NEW.status := 'em_andamento';
  ELSE
    NEW.status := 'pendente';
  END IF;
  RETURN NEW;
END;
$function$;

-- [#2] _salvar_cq_pos_core: NÃO deixa confirmar o CQ Pós sem o CQ Pré confirmado
-- (o Pós é sobre a grade real do Pré; sem o Pré a base está vazia/provisória).
CREATE OR REPLACE FUNCTION public._salvar_cq_pos_core(_cad_id uuid, _cq_pos jsonb, _itens jsonb, _confirmar boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cq_id uuid; v_status_atual text; v_status_pre text;
  v_status text; v_confirmado_at timestamptz; r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  SELECT id, status_pos, status INTO v_cq_id, v_status_atual, v_status_pre
  FROM public.controle_qualidade WHERE cad_id = _cad_id;

  IF _confirmar AND COALESCE(v_status_pre,'') <> 'confirmado' THEN
    RAISE EXCEPTION 'Confirme o CQ (Pré) deste modelo antes de confirmar o CQ Pós.';
  END IF;

  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  IF v_cq_id IS NULL THEN
    INSERT INTO public.controle_qualidade
      (cad_id, tenant_id, status_pos, confirmado_pos_at, observacoes_cq_pos, fotografado_variantes_pos)
    VALUES (_cad_id, v_tenant, v_status, v_confirmado_at,
            _cq_pos->>'observacoes_cq_pos', COALESCE(_cq_pos->'fotografado_variantes_pos','{}'::jsonb))
    RETURNING id INTO v_cq_id;
  ELSE
    UPDATE public.controle_qualidade SET
      status_pos = v_status,
      confirmado_pos_at = CASE WHEN v_status = 'confirmado' THEN COALESCE(confirmado_pos_at, now()) ELSE NULL END,
      observacoes_cq_pos = _cq_pos->>'observacoes_cq_pos',
      fotografado_variantes_pos = COALESCE(_cq_pos->'fotografado_variantes_pos','{}'::jsonb)
    WHERE id = v_cq_id;
  END IF;

  DELETE FROM public.cq_pos_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_itens) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_itens) LOOP
      INSERT INTO public.cq_pos_variantes
        (controle_qualidade_id, producao_terceirizado_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id, (r->>'producao_terceirizado_id')::uuid, (r->>'variante_numero')::int, r->>'etapa',
        COALESCE(r->'grades','{}'::jsonb), COALESCE((r->>'grade_total')::int, 0), NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status_pos', v_status);
END;
$function$;

-- [#4] salvar_terceirizados: trava concorrência por cad (evita blocos duplicados de
-- duplo-submit/2 abas). Espelha o pg_advisory_xact_lock das OCs.
CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; b jsonb; v_id uuid; v_ids uuid[] := '{}';
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
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));

  IF jsonb_typeof(_blocos) = 'array' THEN
    FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
      IF NULLIF(b->>'id','') IS NOT NULL THEN
        UPDATE public.producao_terceirizados SET
          categoria_terceirizado_id = NULLIF(b->>'categoria_terceirizado_id','')::uuid,
          interno = COALESCE((b->>'interno')::boolean, false),
          empresa_id = NULLIF(b->>'empresa_id','')::uuid,
          representante_id = NULLIF(b->>'representante_id','')::uuid,
          colaborador_id = NULLIF(b->>'colaborador_id','')::uuid,
          ativo = COALESCE((b->>'ativo')::boolean, true),
          preco_metro_unidade = NULLIF(b->>'preco_metro_unidade','')::numeric,
          quantidade_enviada = NULLIF(b->>'quantidade_enviada','')::int,
          quantidade_recebida = NULLIF(b->>'quantidade_recebida','')::int,
          quantidade_defeito = NULLIF(b->>'quantidade_defeito','')::int,
          desconto_total = COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0),
          multa_total = COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          numero_parcelas = GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
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
          cad_id, categoria_terceirizado_id, interno, empresa_id, representante_id,
          colaborador_id, ativo, preco_metro_unidade, quantidade_enviada, quantidade_recebida,
          quantidade_defeito, desconto_total, multa_total, numero_parcelas,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados
        ) VALUES (
          _cad_id, NULLIF(b->>'categoria_terceirizado_id','')::uuid, COALESCE((b->>'interno')::boolean, false),
          NULLIF(b->>'empresa_id','')::uuid, NULLIF(b->>'representante_id','')::uuid,
          NULLIF(b->>'colaborador_id','')::uuid, COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'preco_metro_unidade','')::numeric, NULLIF(b->>'quantidade_enviada','')::int,
          NULLIF(b->>'quantidade_recebida','')::int, NULLIF(b->>'quantidade_defeito','')::int,
          COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0), COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
          NULLIF(b->>'data_enviado','')::date, NULLIF(b->>'data_prevista','')::date, NULLIF(b->>'data_entregue','')::date,
          b->>'observacao', COALESCE(b->'aviamentos_enviados', '[]'::jsonb), COALESCE(b->'tecidos_enviados', '[]'::jsonb)
        ) RETURNING id INTO v_id;
      END IF;
      v_ids := array_append(v_ids, v_id);
    END LOOP;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.producao_terceirizados pt
    JOIN public.parcelas_servico ps ON ps.producao_terceirizado_id = pt.id
    WHERE pt.cad_id = _cad_id AND NOT (pt.id = ANY(v_ids))
      AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Não é possível remover um serviço com parcela já paga (apagaria o histórico financeiro). Mantenha o bloco ou estorne a parcela antes.';
  END IF;

  DELETE FROM public.producao_terceirizados WHERE cad_id = _cad_id AND NOT (id = ANY(v_ids));
  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;

-- [#1 + #3] servicos_financeiro: parcela nasce com data_vencimento = data-base (entrega
-- senão envio) e backfill dos NULLs → aparece no calendário (decisão do dono: prazo manual,
-- mas garantir a data-base). E parcela/bloco com parcela PAGA nunca some da lista/total.
CREATE OR REPLACE FUNCTION public.servicos_financeiro()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id(); r record; v_out jsonb;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;

  FOR r IN
    SELECT pt.id, pt.cad_id, GREATEST(COALESCE(pt.numero_parcelas,1),1) AS n,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina, pt.data_enviado, pt.data_entregue
    FROM producao_terceirizados pt
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    WHERE COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
  LOOP
    IF (NOT r.is_oficina AND r.data_enviado IS NOT NULL AND r.data_entregue IS NOT NULL)
       OR (r.is_oficina AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = r.cad_id AND cq.status = 'confirmado'))
    THEN
      INSERT INTO parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento)
      SELECT v_tenant, r.id, gs, COALESCE(r.data_entregue, r.data_enviado) FROM generate_series(1, r.n) gs
      ON CONFLICT (producao_terceirizado_id, numero_parcela) DO NOTHING;
      -- Garante a data-base nas parcelas ainda sem vencimento (não sobrescreve manual).
      UPDATE parcelas_servico ps SET data_vencimento = COALESCE(r.data_entregue, r.data_enviado)
       WHERE ps.producao_terceirizado_id = r.id AND ps.data_vencimento IS NULL
         AND COALESCE(r.data_entregue, r.data_enviado) IS NOT NULL;
      DELETE FROM parcelas_servico ps
       WHERE ps.producao_terceirizado_id = r.id AND ps.numero_parcela > r.n
         AND ps.status <> 'pago' AND ps.data_pagamento IS NULL;
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.data_entrega DESC NULLS LAST, t.servico, t.numero_parcela), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT ps.id AS parcela_id, ps.producao_terceirizado_id, ps.numero_parcela,
           GREATEST(COALESCE(pt.numero_parcelas,1),1) AS numero_parcelas,
           COALESCE(ct.nome,'—') AS servico,
           COALESCE(rep.nome, emp.nome_fantasia, col.nome, '—') AS responsavel,
           COALESCE(rep.cnpj, emp.cnpj) AS responsavel_cnpj,
           emp.nome_fantasia AS empresa_nome, emp.cnpj AS empresa_cnpj,
           rep.nome AS representante_nome, rep.cnpj AS representante_cnpj,
           (COALESCE(ct.nome,'') ILIKE 'oficina') AS is_oficina,
           m.ref, m.nome AS modelo_nome,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0)) AS custo_bruto,
           COALESCE(pt.desconto_total,0) AS desconto, COALESCE(pt.multa_total,0) AS multa,
           (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) AS custo_liquido,
           CASE WHEN ps.numero_parcela >= GREATEST(COALESCE(pt.numero_parcelas,1),1)
                THEN (COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0))
                     - round((COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) / GREATEST(COALESCE(pt.numero_parcelas,1),1), 2) * (GREATEST(COALESCE(pt.numero_parcelas,1),1) - 1)
                ELSE round((COALESCE(pt.preco_metro_unidade,0) * COALESCE(pt.quantidade_enviada,0) - COALESCE(pt.desconto_total,0) + COALESCE(pt.multa_total,0)) / GREATEST(COALESCE(pt.numero_parcelas,1),1), 2)
           END AS valor_parcela,
           pt.data_entregue AS data_entrega, ps.data_vencimento, ps.status, ps.data_pagamento
    FROM parcelas_servico ps
    JOIN producao_terceirizados pt ON pt.id = ps.producao_terceirizado_id
    JOIN cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
    JOIN modelos m ON m.id = c.modelo_id
    LEFT JOIN categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
    LEFT JOIN representantes rep ON rep.id = pt.representante_id
    LEFT JOIN empresas emp ON emp.id = pt.empresa_id
    LEFT JOIN colaboradores col ON col.id = pt.colaborador_id
    WHERE ps.tenant_id = v_tenant
      AND COALESCE(pt.interno,false) = false AND COALESCE(pt.ativo,true)
      -- parcela paga NUNCA some (mesmo fora da faixa numero_parcelas)
      AND (ps.numero_parcela <= GREATEST(COALESCE(pt.numero_parcelas,1),1) OR ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
      -- bloco elegível OU que já tenha alguma parcela paga (não esconde dinheiro pago)
      AND ((COALESCE(ct.nome,'') NOT ILIKE 'oficina' AND pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL)
           OR (COALESCE(ct.nome,'') ILIKE 'oficina' AND EXISTS (SELECT 1 FROM controle_qualidade cq WHERE cq.cad_id = pt.cad_id AND cq.status = 'confirmado'))
           OR EXISTS (SELECT 1 FROM parcelas_servico ps2 WHERE ps2.producao_terceirizado_id = pt.id AND (ps2.status = 'pago' OR ps2.data_pagamento IS NOT NULL)))
  ) t;

  RETURN v_out;
END;
$function$;
