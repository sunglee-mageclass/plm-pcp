-- Inverso de supabase/migrations/20261103160000_camada_estado_vazio.sql - GERADO por .superpowers/sdd/2026-10-05-camada/mig/gerar-c1.mjs (nunca editar a mao).
-- Desenho: .superpowers/sdd/2026-10-05-camada/desenho.md §2.4 (+ plan.md, ledger).
-- NEUTRO: devolve os 6 textos de ANTES (md5 conferido) = o servidor volta a aceitar lista vazia. Sem DROP.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.salvar_terceirizados(uuid,jsonb,text,jsonb)
--     ANTES  7199a05fac6716ac110bfa637944c2e9
--     DEPOIS 8f62269d795eb29e942d089c1c44e698
--   public.salvar_direcionamento(uuid,jsonb,jsonb)
--     ANTES  7f5e84c87bcfe7f14d123053063da1d0
--     DEPOIS 602b905c36f1ea1b4c7aa3a85aa0010d
--   public.confirmar_direcionamento(uuid,jsonb,jsonb)
--     ANTES  ae30cec520c8a1cc436e500b3b976396
--     DEPOIS c9b194ed5f4b2f8bf889adc2f0c1c003
--   public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)
--     ANTES  26c656169b6f9ef826e5b93932b15fe9
--     DEPOIS c68f8dca982d5bab85c9f1eda1771672
--   public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)
--     ANTES  ffb1f2c87801362f9f9895be07d71dc0
--     DEPOIS 1fee21683a10b936d0667800073b7873
--   public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)
--     ANTES  5bfa12603078c4c57fbc5abc6a2b7969
--     DEPOIS ad6c775a57fedcc38fb6711af63237c8
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 6 funcoes): nenhuma tabela, nada de auth/storage/realtime. Sem DROP,
-- sem CREATE/DROP TRIGGER/POLICY, sem NOTIFY (assinaturas iguais). Idempotente.
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', '7199a05fac6716ac110bfa637944c2e9', '8f62269d795eb29e942d089c1c44e698'),
      ('public.salvar_direcionamento(uuid,jsonb,jsonb)', '7f5e84c87bcfe7f14d123053063da1d0', '602b905c36f1ea1b4c7aa3a85aa0010d'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', 'ae30cec520c8a1cc436e500b3b976396', 'c9b194ed5f4b2f8bf889adc2f0c1c003'),
      ('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)', '26c656169b6f9ef826e5b93932b15fe9', 'c68f8dca982d5bab85c9f1eda1771672'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)', 'ffb1f2c87801362f9f9895be07d71dc0', '1fee21683a10b936d0667800073b7873'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', '5bfa12603078c4c57fbc5abc6a2b7969', 'ad6c775a57fedcc38fb6711af63237c8')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'camada_c1_estado_vazio_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.salvar_terceirizados(_cad_id uuid, _blocos jsonb, _observacoes_molde text DEFAULT NULL::text, _rev_base jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; b jsonb; v_id uuid; v_ids uuid[] := '{}';
  v_fonte uuid; v_cq_conf boolean; v_total_real int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_terceirizados OU producao_etapas.
  PERFORM public._seg_exige_pagina('producao_terceirizados', 'producao_etapas');
  SELECT tenant_id INTO v_tenant FROM public.cad WHERE id = _cad_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CAD não encontrado'; END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este CAD';
  END IF;
  IF NOT public.tenant_module_enabled('producao') THEN
    RAISE EXCEPTION 'Módulo producao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_cad_id::text));
  -- (medios R13, L1) trava o CQ do cad JÁ AQUI, antes de qualquer bloco: mesma ordem das RPCs
  -- do CQ (controle_qualidade → bloco-fonte), sem deadlock com o rebaixamento do P-192 abaixo.
  -- Sem CQ = nenhuma linha, nenhum efeito.
  PERFORM 1 FROM public.controle_qualidade WHERE cad_id = _cad_id FOR UPDATE;

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
    -- [C1] depois da re-derivação (medios R13, prod #4 / P-192 A): se a Grade Real da fonte ficou
    -- Σ = 0 (mesma conta do [C1] do _salvar_cq_core), o CQ deixa de estar confirmado — volta a
    -- PENDENTE (o Pós confirmado volta junto, como o [M2] do desmarcar) + #Erro na etapa 'cq'. O
    -- salvar do PCP NÃO é recusado. Lançado/Direcionamento rebaixam pelo trg_rebaixa_lancado_cq.
    SELECT COALESCE(SUM(GREATEST(0, COALESCE((cell->>'recebida')::int,0) - COALESCE((cell->>'defeito')::int,0))), 0)
      INTO v_total_real
      FROM public.producao_terceirizados pt, jsonb_path_query(COALESCE(pt.grade_detalhe,'{}'::jsonb),'$.*.*') cell
     WHERE pt.id = v_fonte;
    IF v_total_real = 0 THEN
      UPDATE public.controle_qualidade
         SET status = 'pendente', confirmado_at = NULL,
             status_pos = CASE WHEN status_pos = 'confirmado' THEN 'pendente' ELSE status_pos END,
             confirmado_pos_at = CASE WHEN status_pos = 'confirmado' THEN NULL ELSE confirmado_pos_at END
       WHERE cad_id = _cad_id AND status = 'confirmado';
      IF FOUND THEN  -- (L3) só acende o #Erro se o CQ de fato foi rebaixado
        UPDATE public.modelos
           SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) || '{"cq": true}'::jsonb
         WHERE id = (SELECT modelo_id FROM public.cad WHERE id = _cad_id);
      END IF;
    END IF;
  END IF;

  UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_direcionamento(_cad_id uuid, _rows jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_direcionamento.
  PERFORM public._seg_exige_pagina('producao_direcionamento');
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, false, false, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_direcionamento(_cad_id uuid, _rows jsonb, _rev_base jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;  -- [seg s1 DIR-1]
BEGIN
  -- [seg s1 DIR-1] login + loja do CAD ANTES do _cq_liberado: sem isto, com um UUID, quem nao esta logado (ou outra loja)
  -- descobria se o CQ do CAD esta liberado. Nao encontrado = outra loja (mesma resposta: sem oraculo). ASCII.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado: faca login de novo' USING ERRCODE = '42501';
  END IF;
  -- [seg s3b] permissao de PAGINA no servidor (Reforco de seguranca S3b, P-231 = D2 A): exige EDITAR producao_direcionamento.
  PERFORM public._seg_exige_pagina('producao_direcionamento');
  SELECT c.tenant_id INTO v_tenant FROM public.cad c WHERE c.id = _cad_id;
  IF v_tenant IS NULL OR (v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin()) THEN
    RAISE EXCEPTION 'cad_nao_encontrado: CAD nao encontrado nesta loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._cq_liberado(_cad_id) THEN
    RAISE EXCEPTION 'O Controle de Qualidade deste modelo não está liberado — confirme o CQ (Pré e, se houver acabamento, o Pós) antes de confirmar o Direcionamento.'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public._salvar_direcionamento_core(_cad_id, _rows, true, true, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_tecido(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_tecido.
  PERFORM public._seg_exige_pagina('entrada_oc_tecido');
  RETURN public._salvar_oc_tecido_core(_oc_id, _oc, _itens, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_aviamento(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_aviamento.
  PERFORM public._seg_exige_pagina('entrada_oc_aviamento');
  RETURN public._salvar_oc_aviamento_core(_oc_id, _oc, _itens, _rev_base);
END;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_oc_etiqueta(_oc_id uuid, _oc jsonb, _itens jsonb, _rev_base integer DEFAULT NULL::integer)
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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  IF NOT public.tenant_module_enabled('entrada_saida') THEN
    RAISE EXCEPTION 'Módulo entrada_saida não habilitado' USING ERRCODE='42501';
  END IF;
  -- [seg s3a] permissao de PAGINA no servidor (Reforco de seguranca S3a, P-231 = D2 A): exige EDITAR entrada_oc_insumo.
  PERFORM public._seg_exige_pagina('entrada_oc_insumo');
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant';
  END IF;

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  IF _rev_base IS NOT NULL THEN
    DECLARE v_rev int;
    BEGIN
      SELECT rev INTO v_rev FROM public.ocs_etiqueta
        WHERE id = _oc_id AND (tenant_id = v_tenant OR public.is_super_admin())
        FOR UPDATE;
      IF v_rev IS DISTINCT FROM _rev_base THEN
        RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa'
          USING ERRCODE = 'P0409';
      END IF;
    END;
  END IF;

  -- itens só de insumo da loja (IDOR)
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    JOIN public.etiquetas et ON et.id = (e->>'etiqueta_id')::uuid
    WHERE e->>'etiqueta_id' IS NOT NULL AND et.tenant_id IS DISTINCT FROM v_tenant
  ) THEN
    RAISE EXCEPTION 'Insumo de outra loja não pode ser adicionado à OC.';
  END IF;

  IF v_oc_id IS NULL THEN
    v_num := _oc->>'numero_pedido';
    IF v_num IS NOT NULL AND v_num <> '' THEN
      WHILE EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE tenant_id = v_tenant AND numero_pedido = v_num) LOOP
        v_num := regexp_replace(v_num, '\d+$', lpad(((regexp_replace(v_num,'^.*\D',''))::bigint + 1)::text, 5, '0'));
      END LOOP;
    END IF;

    INSERT INTO public.ocs_etiqueta
      (tenant_id, numero_pedido, responsavel_nome, empresa_id, representante_id, data_pedido, data_prevista_entrega,
       data_entrega, prazo_pagamento, quantidade_prazos, nf_url, nfs, parcelas_recebimento, status, data_nota_entrada)
    VALUES
      (v_tenant, v_num, _oc->>'responsavel_nome', (_oc->>'empresa_id')::uuid, (_oc->>'representante_id')::uuid,
       (_oc->>'data_pedido')::date, (_oc->>'data_prevista_entrega')::date, (_oc->>'data_entrega')::date,
       _oc->>'prazo_pagamento', COALESCE((_oc->>'quantidade_prazos')::int,1), _oc->>'nf_url',
       COALESCE(_oc->'nfs','[]'::jsonb), COALESCE(_oc->'parcelas_recebimento','[]'::jsonb), 'encomendado',
       NULLIF(_oc->>'data_nota_entrada', '')::date)
    RETURNING id INTO v_oc_id;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'etiqueta_id' IS NOT NULL;

    IF v_recebido THEN UPDATE public.ocs_etiqueta SET status = 'recebido' WHERE id = v_oc_id; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.ocs_etiqueta WHERE id = v_oc_id AND (tenant_id = v_tenant OR public.is_super_admin())) THEN
      RAISE EXCEPTION 'OC não encontrada ou sem permissão';
    END IF;
    -- [seg s6] (Reforco de seguranca S6, P-236 = D7 A) o Salvar NUNCA faz uma OC recebida voltar: so o "Desmarcar recebimento"
    -- (desmarcar_recebimento_oc*) desfaz o recebimento. Trava a linha (2 abas: B recebeu enquanto A editava -> A e recusado).
    IF (SELECT o.status FROM public.ocs_etiqueta o WHERE o.id = v_oc_id FOR UPDATE) = 'recebido'
       AND v_status IS DISTINCT FROM 'recebido' THEN
      RAISE EXCEPTION 'oc_recebida_so_desmarcar: OC recebida so volta a encomendada pelo Desmarcar recebimento' USING ERRCODE = 'P0001';
    END IF;

    v_keep := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
                    WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL);
    DELETE FROM public.ocs_etiqueta_itens WHERE oc_etiqueta_id = v_oc_id AND NOT (id = ANY(v_keep));

    FOR r IN SELECT e FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
             WHERE e->>'id' IS NOT NULL AND e->>'etiqueta_id' IS NOT NULL
    LOOP
      UPDATE public.ocs_etiqueta_itens SET
        etiqueta_id = (r->>'etiqueta_id')::uuid,
        variante_etiqueta_id = NULLIF(r->>'variante_etiqueta_id','')::uuid,
        quantidade_pedida = (r->>'quantidade_pedida')::numeric,
        quantidade_recebida = (r->>'quantidade_recebida')::numeric,
        preco = NULLIF(r->>'preco','')::numeric,
        cancelado = COALESCE((r->>'cancelado')::boolean,false)
      WHERE id = (r->>'id')::uuid AND oc_etiqueta_id = v_oc_id;
    END LOOP;

    INSERT INTO public.ocs_etiqueta_itens
      (oc_etiqueta_id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado)
    SELECT v_oc_id, (e->>'etiqueta_id')::uuid, NULLIF(e->>'variante_etiqueta_id','')::uuid,
           (e->>'quantidade_pedida')::numeric, (e->>'quantidade_recebida')::numeric,
           NULLIF(e->>'preco','')::numeric, COALESCE((e->>'cancelado')::boolean,false)
    FROM jsonb_array_elements(COALESCE(_itens,'[]'::jsonb)) e
    WHERE e->>'id' IS NULL AND e->>'etiqueta_id' IS NOT NULL;

    UPDATE public.ocs_etiqueta SET
      numero_pedido = _oc->>'numero_pedido',
      responsavel_nome = _oc->>'responsavel_nome',
      empresa_id = (_oc->>'empresa_id')::uuid,
      representante_id = (_oc->>'representante_id')::uuid,
      data_pedido = (_oc->>'data_pedido')::date,
      data_prevista_entrega = (_oc->>'data_prevista_entrega')::date,
      data_entrega = (_oc->>'data_entrega')::date,
      prazo_pagamento = _oc->>'prazo_pagamento',
      quantidade_prazos = COALESCE((_oc->>'quantidade_prazos')::int,1),
      nf_url = _oc->>'nf_url',
      nfs = COALESCE(_oc->'nfs','[]'::jsonb),
      parcelas_recebimento = COALESCE(_oc->'parcelas_recebimento','[]'::jsonb),
      data_nota_entrada = CASE WHEN _oc ? 'data_nota_entrada' THEN NULLIF(_oc->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      status = v_status
    WHERE id = v_oc_id;
  END IF;

  IF v_recebido THEN PERFORM public.recalcular_parcelas_etiqueta(v_oc_id); END IF;
  RETURN v_oc_id;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', '7199a05fac6716ac110bfa637944c2e9', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.salvar_direcionamento(uuid,jsonb,jsonb)', '7f5e84c87bcfe7f14d123053063da1d0', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.confirmar_direcionamento(uuid,jsonb,jsonb)', 'ae30cec520c8a1cc436e500b3b976396', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.salvar_oc_tecido(uuid,jsonb,jsonb,integer)', '26c656169b6f9ef826e5b93932b15fe9', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.salvar_oc_aviamento(uuid,jsonb,jsonb,integer)', 'ffb1f2c87801362f9f9895be07d71dc0', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'),
      ('public.salvar_oc_etiqueta(uuid,jsonb,jsonb,integer)', '5bfa12603078c4c57fbc5abc6a2b7969', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'camada_c1_estado_vazio_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'camada_c1_estado_vazio_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
