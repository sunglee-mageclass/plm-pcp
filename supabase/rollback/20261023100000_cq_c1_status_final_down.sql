-- INVERSO de supabase/migrations/20261023100000_cq_c1_status_final.sql (achados MEDIOS R13: prod #4 + P-192 A, prod #5).
-- Devolve o texto de ANTES das 3 funcoes: _salvar_cq_core ([C1] so no clique "Confirmar"), salvar_terceirizados
-- (re-deriva a Grade Real sem rebaixar o CQ) e fn_rebaixa_lancado_cq (sai cedo se o modelo nao esta lancado; nao
-- rebaixa o Direcionamento). O gatilho trg_rebaixa_lancado_cq nao e tocado.
-- Guarda: so roda se as 3 estao EXATAMENTE com o texto da ida (md5 de depois) e _aplicar_reais_do_grade_detalhe
-- segue com o texto conferido; outro -> P0001 e nada muda. Nada gravado muda (CQs/direcionamentos ja rebaixados
-- pela regra nova continuam como estao; o CQ se reconfirma pela tela).
-- LIFO: este inverso roda ANTES de supabase/rollback/20261006120000_sku_previa_mensagens_ascii_down.sql (que confere
-- _salvar_cq_core 8ce76165 e salvar_terceirizados 53ab6f80, os textos que esta volta devolve). Sem site a voltar.
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
      ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', '2fbf741d11b7f0131a99999e2f45fcf4'),
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', 'a87f0e961fe91114b4dc6f981f652177'),
      ('public.fn_rebaixa_lancado_cq()', '3bff4214c95be84f342a4e0be2bddaff'),
      ('public._aplicar_reais_do_grade_detalhe(uuid,uuid)', '00f804865d9ad71c41c37351dc06178c')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r13 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r13 (volta): % nao esta com o texto esperado da 20261023100000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r13v_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)'),
                 ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)'),
                 ('public.fn_rebaixa_lancado_cq()')) v(s);

CREATE OR REPLACE FUNCTION public._salvar_cq_core(_cad_id uuid, _cq jsonb, _variantes jsonb, _reais jsonb, _confirmar boolean DEFAULT false, _rev_base jsonb DEFAULT NULL::jsonb)
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

  -- Trava otimista DOS DOIS LADOS (spec 2026-08-07): _rev_base = { cq: rev, fonte: rev|null }.
  -- cq: confere controle_qualidade.rev — só se a linha já existe (CQ novo não trava). fonte:
  -- confere producao_terceirizados.rev do bloco-fonte — só se há fonte E base.fonte não-nula.
  -- _rev_base null/ausente = bypass (compat + super_admin). Lê FOR UPDATE (segura o lock).
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev_cq int; v_rev_ft int;
    BEGIN
      IF (_rev_base ? 'cq') AND (_rev_base->>'cq') IS NOT NULL THEN
        SELECT rev INTO v_rev_cq FROM public.controle_qualidade
          WHERE cad_id = _cad_id AND (tenant_id = public.get_user_tenant_id() OR public.is_super_admin())
          FOR UPDATE;
        IF v_rev_cq IS NOT NULL AND v_rev_cq IS DISTINCT FROM (_rev_base->>'cq')::int THEN
          RAISE EXCEPTION 'conflito_versao: o Controle de Qualidade foi salvo por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END IF;
      IF v_fonte IS NOT NULL AND (_rev_base ? 'fonte') AND (_rev_base->>'fonte') IS NOT NULL THEN
        SELECT rev INTO v_rev_ft FROM public.producao_terceirizados WHERE id = v_fonte FOR UPDATE;
        IF v_rev_ft IS DISTINCT FROM (_rev_base->>'fonte')::int THEN
          RAISE EXCEPTION 'conflito_versao: a grade do servico-fonte foi salva por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END IF;
    END;
  END IF;

  -- FONTE ÚNICA (cedo, ANTES do [C1]): se há bloco-fonte, mescla recebida/defeito do payload no
  -- grade_detalhe do bloco (traduzindo variante_numero→variante_tecido_id via ordem). PRESERVA
  -- enviada/cortada. Rola quantidade_enviada/recebida/defeito = Σ das células (F2: enviada mantém o
  -- auto_status coerente). Feito antes do [C1] para que guard e Grade Real usem a MESMA fonte; se o
  -- [C1] abortar, este UPDATE é revertido na mesma txn.
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
      quantidade_enviada  = (SELECT COALESCE(SUM((cell->>'enviada')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_recebida = (SELECT COALESCE(SUM((cell->>'recebida')::int),0) FROM jsonb_path_query(v_gd,'$.*.*') cell),
      quantidade_defeito  = (SELECT COALESCE(SUM((cell->>'defeito')::int),0)  FROM jsonb_path_query(v_gd,'$.*.*') cell)
    WHERE id = v_fonte;
  END IF;

  -- [C1] confirmar exige ter contado ao menos 1 peça (Σ da Grade Real > 0). COM fonte: Σ max(0,
  -- recebida−defeito) sobre as células do grade_detalhe (a MESMA fonte da Grade Real gravada).
  -- SEM fonte: Σ do _reais do cliente (comportamento atual).
  IF _confirmar THEN
    IF v_fonte IS NOT NULL THEN
      SELECT COALESCE(SUM(GREATEST(0, COALESCE((cell->>'recebida')::int,0) - COALESCE((cell->>'defeito')::int,0))), 0)
        INTO v_total_real FROM jsonb_path_query(COALESCE(v_gd,'{}'::jsonb),'$.*.*') cell;
    ELSE
      SELECT COALESCE(SUM((SELECT COALESCE(SUM(x.value::int),0) FROM jsonb_each_text(COALESCE(e->'grades','{}'::jsonb)) x)), 0)
        INTO v_total_real FROM jsonb_array_elements(COALESCE(_reais,'[]'::jsonb)) e;
    END IF;
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

CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL::text, _rev_base jsonb DEFAULT NULL::jsonb)
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

  -- Trava otimista POR BLOCO (spec 2026-08-07): _rev_base = { bloco_id: rev }. Cada bloco
  -- EXISTENTE (com id) presente no payload tem o rev conferido contra o base; divergência =
  -- P0409. Bloco novo (sem id) não trava. Bloco sem entrada no base = bypass. _rev_base
  -- null/ausente = bypass (compat + super_admin). Lê FOR UPDATE (segura o lock até o UPDATE).
  IF _rev_base IS NOT NULL AND jsonb_typeof(_blocos) = 'array' THEN
    DECLARE v_bid uuid; v_rev int; v_base int;
    BEGIN
      FOR b IN SELECT value FROM jsonb_array_elements(_blocos) LOOP
        v_bid := NULLIF(b->>'id','')::uuid;
        IF v_bid IS NULL THEN CONTINUE; END IF;                 -- bloco novo não trava
        IF NOT (_rev_base ? v_bid::text) THEN CONTINUE; END IF; -- sem base p/ este bloco = bypass
        IF (_rev_base->>v_bid::text) IS NULL THEN CONTINUE; END IF;
        v_base := (_rev_base->>v_bid::text)::int;
        SELECT rev INTO v_rev FROM public.producao_terceirizados
          WHERE id = v_bid AND cad_id = _cad_id FOR UPDATE;     -- cad já foi tenant-verificado acima
        IF v_rev IS DISTINCT FROM v_base THEN
          RAISE EXCEPTION 'conflito_versao: um servico foi salvo por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END LOOP;
    END;
  END IF;

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
          grade_detalhe = COALESCE(b->'grade_detalhe', '{}'::jsonb),
          pt_data_saida = NULLIF(b->>'pt_data_saida','')::date,
          pt_data_entrada = NULLIF(b->>'pt_data_entrada','')::date,
          pt_aprovacao = NULLIF(b->>'pt_aprovacao',''),
          nf_saida = COALESCE(b->'nf_saida', '[]'::jsonb),
          nf_entrada = COALESCE(b->'nf_entrada', '[]'::jsonb),
          peca_foto = COALESCE((b->>'peca_foto')::boolean, false),
          peca_foto_data = NULLIF(b->>'peca_foto_data','')::date
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_terceirizados (
          cad_id, categoria_terceirizado_id, interno, empresa_id, representante_id,
          colaborador_id, ativo, preco_metro_unidade, quantidade_enviada, quantidade_recebida,
          quantidade_defeito, desconto_total, multa_total, numero_parcelas,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados,
          detalhado, grade_detalhe, pt_data_saida, pt_data_entrada, pt_aprovacao, nf_saida, nf_entrada,
          peca_foto, peca_foto_data
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
          COALESCE((b->>'detalhado')::boolean, false), COALESCE(b->'grade_detalhe', '{}'::jsonb),
          NULLIF(b->>'pt_data_saida','')::date, NULLIF(b->>'pt_data_entrada','')::date, NULLIF(b->>'pt_aprovacao',''),
          COALESCE(b->'nf_saida','[]'::jsonb), COALESCE(b->'nf_entrada','[]'::jsonb),
          COALESCE((b->>'peca_foto')::boolean, false), NULLIF(b->>'peca_foto_data','')::date
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

CREATE OR REPLACE FUNCTION public.fn_rebaixa_lancado_cq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_modelo uuid;
  v_tem_pos boolean;
  v_liberado boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.status_pos IS NOT DISTINCT FROM OLD.status_pos THEN
    RETURN NEW;
  END IF;

  SELECT modelo_id INTO v_modelo FROM public.cad WHERE id = NEW.cad_id;
  IF v_modelo IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.modelos WHERE id = v_modelo AND lancado) THEN
    RETURN NEW;
  END IF;

  v_tem_pos := EXISTS (
    SELECT 1 FROM public.producao_terceirizados t
      JOIN public.categorias_terceirizado ct ON ct.id = t.categoria_terceirizado_id
     WHERE t.cad_id = NEW.cad_id AND t.ativo AND ct.etapa = 'pos_costura'
  );
  v_liberado := (NEW.status = 'confirmado')
                AND (NOT v_tem_pos OR NEW.status_pos = 'confirmado');

  IF NOT v_liberado THEN
    UPDATE public.modelos
       SET lancado = false,
           revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) || '{"lancamentos": true}'::jsonb
     WHERE id = v_modelo AND lancado;
  END IF;
  RETURN NEW;
END;
$function$;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', '8ce76165ffa3ae67d5cdb12eb95bb620'),
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', '53ab6f802117489e1f794aa411e755ba'),
      ('public.fn_rebaixa_lancado_cq()', 'ad991b81358029c2df58c05042f228d5'),
      ('public._aplicar_reais_do_grade_detalhe(uuid,uuid)', '00f804865d9ad71c41c37351dc06178c')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r13 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _r13v_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r13 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)'),
                                 ('public._aplicar_reais_do_grade_detalhe(uuid,uuid)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r13 (volta): % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r13 (volta): % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)')
                   AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r13 (volta): ACL de salvar_terceirizados fora do esperado (authenticated sim; anon/PUBLIC nao)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'trg_rebaixa_lancado_cq' AND t.tgrelid = to_regclass('public.controle_qualidade')
                    AND t.tgfoid = to_regprocedure('public.fn_rebaixa_lancado_cq()') AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'medios_r13 (volta): gatilho trg_rebaixa_lancado_cq ausente ou desligado' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
