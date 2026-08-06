-- Grade Cortada — FONTE ÚNICA (Task 3).
-- O grade_detalhe do BLOCO-FONTE de confecção passa a ser a fonte canônica de recebida/defeito;
-- a Grade Real (cad_grades.grades_reais) é DERIVADA dele (max(0, recebida − defeito) por célula),
-- tudo ATÔMICO dentro do _salvar_cq_core (uma txn DEFINER). Editar recebida no PCP
-- (salvar_terceirizados) com CQ confirmado re-deriva a Grade Real. + helpers de resolução SQL
-- (paridade com src/lib/confeccao-fonte.ts) + reconciliação idempotente dos modelos em voo.
--
-- Idempotente (CREATE OR REPLACE + guards) e envolvido em BEGIN/COMMIT (consolida dados).
-- ⚠️ ORDEM: unaccent_simple ANTES de _categoria_eh_confeccao/_pl (funções LANGUAGE sql têm o
--    corpo dependency-checado no CREATE — referenciar função inexistente falha).

BEGIN;

-- 0) unaccent_simple: remove acentos sem depender da extensão unaccent (translate ASCII).
--    Espelha o strip de diacríticos do norm() de src/lib/servico-confeccao.ts para os tokens
--    de confecção (todos ASCII), cobrindo os acentos comuns do PT-BR.
CREATE OR REPLACE FUNCTION public.unaccent_simple(_s text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT translate(_s,
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC');
$$;

-- 1) Categoria é de confecção? (espelha isServicoConfeccao: oficina/costura/pl/private label)
CREATE OR REPLACE FUNCTION public._categoria_eh_confeccao(_nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _nome IS NULL THEN false
    ELSE (
      lower(public.unaccent_simple(_nome)) LIKE '%private label%'
      OR EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(public.unaccent_simple(_nome)), '[^a-z0-9]+') tok
        WHERE tok IN ('oficina','oficinas','costura','costuras','pl','pls')
      )
    )
  END;
$$;

-- 2) É PL/Private Label? (prioridade default; espelha isServicoPL)
CREATE OR REPLACE FUNCTION public._categoria_eh_pl(_nome text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN _nome IS NULL THEN false
    ELSE (
      lower(public.unaccent_simple(_nome)) LIKE '%private label%'
      OR EXISTS (
        SELECT 1 FROM regexp_split_to_table(lower(public.unaccent_simple(_nome)), '[^a-z0-9]+') tok
        WHERE tok IN ('pl','pls')
      )
    )
  END;
$$;

-- 3) Resolve O bloco-fonte de confecção (destrinchado, ativo) de um CAD.
--    Prioridade: array tenant_config.confeccao_prioridade (posição 1-based); default PL(0) antes
--    de Oficina(1); desempate estável por created_at. Espelha resolverFonteConfeccao (Task 2):
--    para blocos listados o array manda (posição), para não-listados PL antes; created_at é o
--    último critério em ambos os lados.
CREATE OR REPLACE FUNCTION public._resolver_fonte_confeccao(_cad_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_tenant uuid; v_prio jsonb; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(confeccao_prioridade, '[]'::jsonb) INTO v_prio
    FROM public.tenant_config WHERE tenant_id = v_tenant;
  v_prio := COALESCE(v_prio, '[]'::jsonb);
  SELECT pt.id INTO v_id
    FROM public.producao_terceirizados pt
    JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
   WHERE pt.cad_id = _cad_id AND pt.ativo AND pt.detalhado
     AND public._categoria_eh_confeccao(ct.nome)
   ORDER BY
     -- rank explícito (posição no array; array_position é 1-based ou NULL), depois default
     -- PL<Oficina, depois estável por created_at (ascendente = bloco mais antigo vence).
     COALESCE(NULLIF(array_position(ARRAY(SELECT jsonb_array_elements_text(v_prio))::uuid[], pt.categoria_terceirizado_id), 0), 999),
     CASE WHEN public._categoria_eh_pl(ct.nome) THEN 0 ELSE 1 END,
     pt.created_at
   LIMIT 1;
  RETURN v_id;
END;
$$;

-- Invariante #9: helpers de decisão com EXECUTE revogado dos TRÊS (PUBLIC herda p/ anon/authenticated).
REVOKE EXECUTE ON FUNCTION public._resolver_fonte_confeccao(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._categoria_eh_confeccao(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._categoria_eh_pl(text) FROM PUBLIC, anon, authenticated;

-- 4) Helper compartilhado: aplica cad_grades.grades_reais a partir do grade_detalhe do bloco-fonte
--    (max(0, recebida − defeito) por célula). Usado por _salvar_cq_core E por salvar_terceirizados
--    (mesma fórmula = zero drift). Só cria/atualiza a linha da variante que TEM célula no
--    grade_detalhe (não zera variantes intactas). PRESERVA grades_planejadas (invariante #7):
--    no INSERT nova linha nasce com planejadas=reais; no CONFLICT só reais/grade_total_real mudam.
CREATE OR REPLACE FUNCTION public._aplicar_reais_do_grade_detalhe(_cad_id uuid, _fonte uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_gd jsonb; ctv record; v_tam text; v_grades jsonb; v_total int; v_rec int; v_def int;
BEGIN
  SELECT COALESCE(grade_detalhe,'{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = _fonte;
  FOR ctv IN
    SELECT c.ordem, c.variante_tecido_id
      FROM public.cad_tecidos ct
      JOIN public.cad_tecido_variantes c ON c.cad_tecido_id = ct.id
     WHERE ct.cad_id = _cad_id AND ct.tipo='tecido' AND ct.numero=1
  LOOP
    v_grades := '{}'::jsonb; v_total := 0;
    FOR v_tam IN SELECT jsonb_object_keys(COALESCE(v_gd->ctv.variante_tecido_id::text,'{}'::jsonb)) LOOP
      v_rec := COALESCE((v_gd->ctv.variante_tecido_id::text->v_tam->>'recebida')::int,0);
      v_def := COALESCE((v_gd->ctv.variante_tecido_id::text->v_tam->>'defeito')::int,0);
      v_grades := jsonb_set(v_grades, ARRAY[v_tam], to_jsonb(GREATEST(0, v_rec - v_def)), true);
      v_total := v_total + GREATEST(0, v_rec - v_def);
    END LOOP;
    IF v_gd ? ctv.variante_tecido_id::text THEN
      INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
      VALUES (_cad_id, ctv.ordem, v_grades, v_grades, v_total, v_total)
      ON CONFLICT (cad_id, variante_numero) DO UPDATE
        SET grades_reais = EXCLUDED.grades_reais, grade_total_real = EXCLUDED.grade_total_real;
    END IF;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._aplicar_reais_do_grade_detalhe(uuid,uuid) FROM PUBLIC, anon, authenticated;

-- 5) _salvar_cq_core estendido. Corpo IDÊNTICO ao vigente (controle_qualidade INSERT/UPDATE,
--    cq_variantes) + FONTE ÚNICA: se há bloco-fonte, grava recebida/defeito no grade_detalhe do
--    bloco (traduzindo variante_numero→variante_tecido_id via cad_tecido_variantes.ordem),
--    PRESERVA enviada/cortada, e deriva cad_grades DO grade_detalhe (não do _reais do cliente).
CREATE OR REPLACE FUNCTION public._salvar_cq_core(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cq_id uuid; v_status_atual text; v_status text; v_confirmado_at timestamptz;
  v_total_real int; r jsonb;
  v_fonte uuid; v_gd jsonb; v_vid uuid; v_tam text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;

  v_fonte := public._resolver_fonte_confeccao(_cad_id);

  -- [C1] confirmar exige ter contado ao menos 1 peça (Σ da grade real > 0).
  IF _confirmar THEN
    SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
      INTO v_total_real FROM jsonb_array_elements(COALESCE(_reais,'[]'::jsonb)) e;
    IF v_total_real = 0 THEN
      RAISE EXCEPTION 'Conte ao menos uma peça no Recebimento antes de confirmar o Controle de Qualidade.';
    END IF;
  END IF;

  SELECT id, status INTO v_cq_id, v_status_atual FROM public.controle_qualidade WHERE cad_id = _cad_id;

  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  IF v_cq_id IS NULL THEN
    INSERT INTO public.controle_qualidade (
      cad_id, tenant_id, observacoes_cq, pecas_incompletas, pecas_faltantes, pecas_sem_etiqueta,
      data_conserto_enviado, data_conserto_prevista, data_conserto_entregue,
      data_lavagem_enviado, data_lavagem_entregue,
      data_recebimento_enviado_oficina, data_recebimento_prevista, data_recebimento_entregue,
      fotografado_variantes, status, confirmado_at
    ) VALUES (
      _cad_id, v_tenant, _cq->>'observacoes_cq',
      NULLIF(_cq->>'pecas_incompletas','')::int, NULLIF(_cq->>'pecas_faltantes','')::int, NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      NULLIF(_cq->>'data_conserto_enviado','')::date, NULLIF(_cq->>'data_conserto_prevista','')::date, NULLIF(_cq->>'data_conserto_entregue','')::date,
      NULLIF(_cq->>'data_lavagem_enviado','')::date, NULLIF(_cq->>'data_lavagem_entregue','')::date,
      NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date, NULLIF(_cq->>'data_recebimento_prevista','')::date, NULLIF(_cq->>'data_recebimento_entregue','')::date,
      COALESCE(_cq->'fotografado_variantes', '{}'::jsonb), v_status, v_confirmado_at
    ) RETURNING id INTO v_cq_id;
  ELSE
    UPDATE public.controle_qualidade SET
      observacoes_cq = _cq->>'observacoes_cq',
      pecas_incompletas = NULLIF(_cq->>'pecas_incompletas','')::int,
      pecas_faltantes = NULLIF(_cq->>'pecas_faltantes','')::int,
      pecas_sem_etiqueta = NULLIF(_cq->>'pecas_sem_etiqueta','')::int,
      data_conserto_enviado = NULLIF(_cq->>'data_conserto_enviado','')::date,
      data_conserto_prevista = NULLIF(_cq->>'data_conserto_prevista','')::date,
      data_conserto_entregue = NULLIF(_cq->>'data_conserto_entregue','')::date,
      data_lavagem_enviado = NULLIF(_cq->>'data_lavagem_enviado','')::date,
      data_lavagem_entregue = NULLIF(_cq->>'data_lavagem_entregue','')::date,
      data_recebimento_enviado_oficina = NULLIF(_cq->>'data_recebimento_enviado_oficina','')::date,
      data_recebimento_prevista = NULLIF(_cq->>'data_recebimento_prevista','')::date,
      data_recebimento_entregue = NULLIF(_cq->>'data_recebimento_entregue','')::date,
      fotografado_variantes = COALESCE(_cq->'fotografado_variantes', '{}'::jsonb),
      status = v_status,
      confirmado_at = CASE WHEN v_status = 'confirmado' THEN COALESCE(confirmado_at, now()) ELSE NULL END
    WHERE id = v_cq_id;
  END IF;

  DELETE FROM public.cq_variantes WHERE controle_qualidade_id = v_cq_id;
  IF jsonb_typeof(_variantes) = 'array' THEN
    FOR r IN SELECT value FROM jsonb_array_elements(_variantes) LOOP
      INSERT INTO public.cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total, destino_defeito)
      VALUES (
        v_cq_id, (r->>'variante_numero')::int, r->>'etapa', COALESCE(r->'grades', '{}'::jsonb),
        (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
        NULLIF(r->>'destino_defeito','')
      );
    END LOOP;
  END IF;

  -- FONTE ÚNICA: se há bloco-fonte, escreve recebida/defeito do payload no grade_detalhe do bloco,
  -- traduzindo variante_numero→variante_tecido_id (ordem). PRESERVA enviada/cortada existentes.
  IF v_fonte IS NOT NULL THEN
    SELECT COALESCE(grade_detalhe, '{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = v_fonte;
    FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_variantes,'[]'::jsonb))
             WHERE value->>'etapa' IN ('recebimento','defeito') LOOP
      SELECT ctv.variante_tecido_id INTO v_vid
        FROM public.cad_tecidos ct
        JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
       WHERE ct.cad_id = _cad_id AND ct.tipo='tecido' AND ct.numero=1 AND ctv.ordem = (r->>'variante_numero')::int
       LIMIT 1;
      IF v_vid IS NULL THEN CONTINUE; END IF;
      -- GUARD: jsonb_set NÃO cria chaves intermediárias — garante o objeto da variante antes do
      -- set aninhado, senão o set vira no-op silencioso quando a variante ainda não existe no jsonb.
      IF NOT (v_gd ? v_vid::text) THEN
        v_gd := v_gd || jsonb_build_object(v_vid::text, '{}'::jsonb);
      END IF;
      FOR v_tam IN SELECT jsonb_object_keys(COALESCE(r->'grades','{}'::jsonb)) LOOP
        v_gd := jsonb_set(v_gd, ARRAY[v_vid::text, v_tam],
          COALESCE(v_gd->v_vid::text->v_tam, '{}'::jsonb)
          || jsonb_build_object(CASE WHEN r->>'etapa'='recebimento' THEN 'recebida' ELSE 'defeito' END,
                                COALESCE((r->'grades'->>v_tam)::int,0)), true);
      END LOOP;
    END LOOP;
    UPDATE public.producao_terceirizados SET grade_detalhe = v_gd,
      quantidade_recebida = (SELECT COALESCE(SUM((cell->>'recebida')::int),0) FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_defeito  = (SELECT COALESCE(SUM((cell->>'defeito')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell)
    WHERE id = v_fonte;
  END IF;

  -- Grade Real → cad_grades quando confirmado. COM fonte: deriva do grade_detalhe (recebida−defeito).
  -- SEM fonte: usa _reais do cliente (comportamento atual, verbatim). Ambos preservam grades_planejadas.
  IF v_status = 'confirmado' THEN
    IF v_fonte IS NOT NULL THEN
      PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
    ELSIF jsonb_typeof(_reais) = 'array' THEN
      FOR r IN SELECT value FROM jsonb_array_elements(_reais) LOOP
        INSERT INTO public.cad_grades
          (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
        VALUES (
          _cad_id, (r->>'variante_numero')::int, COALESCE(r->'grades', '{}'::jsonb), COALESCE(r->'grades', '{}'::jsonb),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x),
          (SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(r->'grades','{}'::jsonb)) x)
        )
        ON CONFLICT (cad_id, variante_numero) DO UPDATE
          SET grades_reais = EXCLUDED.grades_reais, grade_total_real = EXCLUDED.grade_total_real;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('cq_id', v_cq_id, 'status', v_status, 'fonte', v_fonte);
END;
$function$;

-- 6) salvar_terceirizados estendido. Corpo VIGENTE inalterado (validações, module gate, advisory
--    lock, loop UPDATE/INSERT dos blocos, guarda de parcela paga, DELETE dos removidos) + após o
--    DELETE, se o CAD tem CQ confirmado e um bloco-fonte, re-deriva cad_grades do grade_detalhe
--    (editar recebida/defeito no PCP move a Grade Real).
CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; b jsonb; v_id uuid; v_ids uuid[] := '{}';
  v_fonte uuid; v_cq_conf boolean;
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
          tecidos_enviados = COALESCE(b->'tecidos_enviados', '[]'::jsonb),
          detalhado = COALESCE((b->>'detalhado')::boolean, false),
          grade_detalhe = COALESCE(b->'grade_detalhe', '{}'::jsonb)
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_terceirizados (
          cad_id, categoria_terceirizado_id, interno, empresa_id, representante_id,
          colaborador_id, ativo, preco_metro_unidade, quantidade_enviada, quantidade_recebida,
          quantidade_defeito, desconto_total, multa_total, numero_parcelas,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados,
          detalhado, grade_detalhe
        ) VALUES (
          _cad_id, NULLIF(b->>'categoria_terceirizado_id','')::uuid, COALESCE((b->>'interno')::boolean, false),
          NULLIF(b->>'empresa_id','')::uuid, NULLIF(b->>'representante_id','')::uuid,
          NULLIF(b->>'colaborador_id','')::uuid, COALESCE((b->>'ativo')::boolean, true),
          NULLIF(b->>'preco_metro_unidade','')::numeric, NULLIF(b->>'quantidade_enviada','')::int,
          NULLIF(b->>'quantidade_recebida','')::int, NULLIF(b->>'quantidade_defeito','')::int,
          COALESCE(NULLIF(b->>'desconto_total','')::numeric, 0), COALESCE(NULLIF(b->>'multa_total','')::numeric, 0),
          GREATEST(COALESCE(NULLIF(b->>'numero_parcelas','')::int, 1), 1),
          NULLIF(b->>'data_enviado','')::date, NULLIF(b->>'data_prevista','')::date, NULLIF(b->>'data_entregue','')::date,
          b->>'observacao', COALESCE(b->'aviamentos_enviados', '[]'::jsonb), COALESCE(b->'tecidos_enviados', '[]'::jsonb),
          COALESCE((b->>'detalhado')::boolean, false), COALESCE(b->'grade_detalhe', '{}'::jsonb)
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

  -- FONTE ÚNICA: com CQ confirmado + bloco-fonte, re-deriva a Grade Real do grade_detalhe
  -- (editar recebida/defeito no PCP move a Grade Real). Mesma fórmula do _salvar_cq_core.
  v_fonte := public._resolver_fonte_confeccao(_cad_id);
  SELECT (status = 'confirmado') INTO v_cq_conf FROM public.controle_qualidade WHERE cad_id = _cad_id;
  IF v_fonte IS NOT NULL AND COALESCE(v_cq_conf, false) THEN
    PERFORM public._aplicar_reais_do_grade_detalhe(_cad_id, v_fonte);
  END IF;

  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;

-- 7) RECONCILIAÇÃO idempotente: para cada CAD com bloco-fonte, backfill de recebida/defeito no
--    grade_detalhe a partir de cq_variantes (traduzindo numero→vid) SOMENTE onde a célula do
--    grade_detalhe está ausente/zerada. grade_detalhe é autoritativo; divergências só logam.
--    NÃO toca cad_grades (não move a Grade Real de modelos em voo; só habilita o novo fluxo).
DO $recon$
DECLARE cad_rec record; v_fonte uuid; v_gd jsonb; cv record; v_vid uuid; v_tam text; v_q int; v_campo text; v_atual int;
BEGIN
  FOR cad_rec IN
    SELECT DISTINCT pt.cad_id AS cad_id
      FROM public.producao_terceirizados pt
      JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
     WHERE pt.ativo AND pt.detalhado AND public._categoria_eh_confeccao(ct.nome)
  LOOP
    v_fonte := public._resolver_fonte_confeccao(cad_rec.cad_id);
    IF v_fonte IS NULL THEN CONTINUE; END IF;
    SELECT COALESCE(grade_detalhe,'{}'::jsonb) INTO v_gd FROM public.producao_terceirizados WHERE id = v_fonte;
    FOR cv IN
      SELECT v.variante_numero, v.etapa, v.grades
        FROM public.cq_variantes v
        JOIN public.controle_qualidade q ON q.id = v.controle_qualidade_id
       WHERE q.cad_id = cad_rec.cad_id AND v.etapa IN ('recebimento','defeito')
    LOOP
      SELECT ctv.variante_tecido_id INTO v_vid
        FROM public.cad_tecidos ct JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
       WHERE ct.cad_id = cad_rec.cad_id AND ct.tipo='tecido' AND ct.numero=1 AND ctv.ordem = cv.variante_numero LIMIT 1;
      IF v_vid IS NULL THEN CONTINUE; END IF;
      v_campo := CASE WHEN cv.etapa='recebimento' THEN 'recebida' ELSE 'defeito' END;
      FOR v_tam IN SELECT jsonb_object_keys(COALESCE(cv.grades,'{}'::jsonb)) LOOP
        v_q := COALESCE((cv.grades->>v_tam)::int,0);
        v_atual := COALESCE((v_gd->v_vid::text->v_tam->>v_campo)::int,0);
        IF v_atual = 0 AND v_q <> 0 THEN
          -- GUARD do jsonb_set: garante o objeto da variante antes do set aninhado.
          IF NOT (v_gd ? v_vid::text) THEN
            v_gd := v_gd || jsonb_build_object(v_vid::text, '{}'::jsonb);
          END IF;
          v_gd := jsonb_set(v_gd, ARRAY[v_vid::text, v_tam],
            COALESCE(v_gd->v_vid::text->v_tam,'{}'::jsonb) || jsonb_build_object(v_campo, v_q), true);
        ELSIF v_atual <> 0 AND v_q <> 0 AND v_atual <> v_q THEN
          RAISE NOTICE 'reconciliacao: cad % vid % tam % campo % diverge (grade_detalhe=% cq=%) -> mantido grade_detalhe',
            cad_rec.cad_id, v_vid, v_tam, v_campo, v_atual, v_q;
        END IF;
      END LOOP;
    END LOOP;
    UPDATE public.producao_terceirizados SET grade_detalhe = v_gd WHERE id = v_fonte;
  END LOOP;
END
$recon$;

COMMIT;
