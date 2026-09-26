-- Mensagens ASCII em RAISE cujo ERRCODE o PostgREST devolve como 5xx (P-58 A / P-59 A do dono, 26/set) — SÓ TEXTO,
-- 1 migration pequena. Achado da QA T6 (SKU em prévia), provado na cópia pelo controlador: o PostgREST 14.13 da cópia
-- responde 500 text/plain "Something went wrong" (perde o code) quando a mensagem de um erro mapeado p/ 5xx (aqui,
-- P0409) tem caractere fora de ASCII — em vez do JSON {"code":"P0409",...} normal. A tela mapeia SÓ pelo `code`
-- (mensagemAplicarSkus, sku-previa.ts:205-206): sem o code, mostra "erro desconhecido" em vez da mensagem certa.
-- Nenhum dado se perde (a transação sempre aborta) — é só o formato da resposta HTTP.
-- Escopo FECHADO (P-59 A, 7 literais em 4 funções; nada além disto muda — mesma assinatura/retorno/volatilidade/
-- ACL/owner/search_path das 4; CREATE OR REPLACE preserva o proacl):
--   _aplicar_skus_modelo_core(uuid,jsonb,text,text) — 2 literais (previa_desatualizada: SKUs mudaram / gravado != prévia)
--   _skus_executar_plano(uuid,uuid,jsonb,boolean) — 3 literais (previa_desatualizada: sairia / mudaria / SKU %)
--   salvar_terceirizados(uuid,jsonb,text,jsonb) — 1 literal (conflito_versao: um serviço)
--   _salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb) — 1 literal (conflito_versao: grade do serviço-fonte)
-- Fora de escopo (P-59 B não escolhida; registrado, não tocado): o 2º P0409 de _salvar_cq_core ('conflito_versao: o
-- Controle de Qualidade foi salvo por outra pessoa') já é ASCII — fica como está. Os 11 P0002 com acento de outras
-- funções ('… não encontrado(a).') e o P0001 de _skus_plano continuam com acento (P0001 é 400 — não afetado pelo bug).
-- ARQUIVO GERADO por .superpowers/sku-previa/mig-ascii/gerar_sql.py a partir do texto VIVO da cópia (dump_antes.sh) —
-- NÃO editar à mão. Guarda de entrada: md5 das 4 = o texto de ANTES OU o de DEPOIS desta migration (idempotente:
-- reaplicar é no-op, senão RAISE). $acl$: confere que o proacl das 4 não mudou (CREATE OR REPLACE preserva). $ascii$:
-- todo comando RAISE...P0409 nas 4 funções é ASCII, e a contagem por função bate com o esperado 3|4|1|2 (R2 do
-- G-plano: por COMANDO, não por linha; comentário -- com acento continua permitido; SÓ a IDA tem este bloco — o
-- inverso restaura os acentos de propósito). $pos$: md5 das 4 = o texto exato esperado. SÓ FUNÇÕES: nenhuma DDL de
-- tabela/policy. Contagens (funções|gatilhos): +0 | +0 (as 4 já existem — CREATE OR REPLACE). Aplicar SÓ pelos
-- scripts de mig-ascii/ (Task 7b) — não psql -f solto.
-- Inverso: supabase/rollback/20261006120000_sku_previa_mensagens_ascii_down.sql (não apaga dado — SKUs/blocos/CQ
-- gravados ficam; só o TEXTO dos 7 literais RAISE muda de volta ao acentuado; SEM $ascii$ — ver comentário no gerador).
-- LIFO (N2/N4 do G-plano): esta migration (20261006120000) é MAIS NOVA que a Distribuição (20261006100000) e que o
-- SKU em prévia (20261005110000). Para voltar a prévia (20261005110000) ou a Distribuição, volte ESTA antes.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: _aplicar_skus_modelo_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)')));
  IF v_md5 NOT IN ('670793ce00dc20234ccecc23f9c4aede', 'fd7ac0cf1b778711ac2098d41e16ead6') THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: _aplicar_skus_modelo_core nao esta nem no texto de antes nem no de depois desta migration (md5 %) — outra frente mudou; regenerar a migration antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: _skus_executar_plano nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)')));
  IF v_md5 NOT IN ('8dd67dd676fac312cfc3c73459342427', '2f4ec047824edbdcf53f7fa9b7e9accb') THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: _skus_executar_plano nao esta nem no texto de antes nem no de depois desta migration (md5 %) — outra frente mudou; regenerar a migration antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: salvar_terceirizados nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)')));
  IF v_md5 NOT IN ('90a91a9c8532704cb35aea207dc15574', '53ab6f802117489e1f794aa411e755ba') THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: salvar_terceirizados nao esta nem no texto de antes nem no de depois desta migration (md5 %) — outra frente mudou; regenerar a migration antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: _salvar_cq_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)')));
  IF v_md5 NOT IN ('8c2be43b5a4af0528093da3726080717', '8ce76165ffa3ae67d5cdb12eb95bb620') THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: _salvar_cq_core nao esta nem no texto de antes nem no de depois desta migration (md5 %) — outra frente mudou; regenerar a migration antes de aplicar', v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._aplicar_skus_modelo_core(_modelo_id uuid, _manuais jsonb, _modo text, _assinatura text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.4) — GRAVA a prévia que o usuário viu, no Salvar do card (DEPOIS
-- do UPDATE do modelo: a REF e o "Tamanho em" já são os do rascunho). Sob a trava 'sku_modelo:<id>' (a mesma de gerar/
-- editar — ordem sku_modelo → linha → sku_unico, sem deadlock), refaz o plano com os valores SALVOS e:
--  • erro num SKU à mão ⇒ RAISE com a MESMA mensagem da prévia (P0001; rev velho = P0409) — nada grava;
--  • assinatura do estado final ≠ a da prévia ⇒ P0409 'previa_desatualizada' — nada grava;
--  • senão executa as ops (estrito) e CONFERE que o gravado = a prévia (mesma assinatura) — senão P0409, tudo desfeito.
DECLARE
  v_tenant uuid;
  v_ref text;
  v_tipo text;
  v_plano jsonb;
  v_exec jsonb;
  v_erro jsonb;
  v_depois text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0));
  SELECT mo.tenant_id, mo.ref, mo.tamanho_tipo INTO v_tenant, v_ref, v_tipo
    FROM public.modelos mo
   WHERE mo.id = _modelo_id;
  v_plano := public._skus_plano(_modelo_id, v_ref, v_tipo, _manuais, _modo);
  v_erro := v_plano -> 'erros' -> 0;
  IF v_erro IS NOT NULL THEN
    IF v_erro ->> 'code' = 'P0409' THEN
      RAISE EXCEPTION '%', v_erro ->> 'mensagem' USING ERRCODE = 'P0409';
    END IF;
    RAISE EXCEPTION '%', v_erro ->> 'mensagem' USING ERRCODE = 'P0001';
  END IF;
  IF _assinatura IS NULL OR _assinatura IS DISTINCT FROM v_plano ->> 'assinatura' THEN
    RAISE EXCEPTION 'previa_desatualizada: os SKUs mudaram desde a previa' USING ERRCODE = 'P0409';
  END IF;
  v_exec := public._skus_executar_plano(_modelo_id, v_tenant, v_plano, true);
  SELECT public._skus_assinatura(coalesce(jsonb_agg(jsonb_build_array(s.variante_key::text, s.tamanho_key, s.sku, s.manual)), '[]'::jsonb))
    INTO v_depois
    FROM public.modelo_skus s
   WHERE s.modelo_id = _modelo_id;
  IF v_depois IS DISTINCT FROM v_plano ->> 'assinatura' THEN
    RAISE EXCEPTION 'previa_desatualizada: o gravado nao bateu com a previa - nada foi gravado' USING ERRCODE = 'P0409';
  END IF;
  RETURN public._skus_matriz_ref_tipo(_modelo_id, v_ref, v_tipo)
      || jsonb_build_object('criados', (v_exec ->> 'criados')::integer, 'atualizados', (v_exec ->> 'atualizados')::integer,
                            'removidos', (v_exec ->> 'removidos')::integer, 'manuais', (v_exec ->> 'manuais')::integer,
                            'conflitos', v_plano -> 'conflitos');
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_executar_plano(_modelo_id uuid, _tenant uuid, _plano jsonb, _estrito boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.1) — EXECUTA, na ordem, as ops de um plano de _skus_plano: a
-- ÚNICA escrita em modelo_skus da geração e da prévia gravada. Quem chama segura a trava 'sku_modelo:<id>' e montou o plano
-- DEPOIS dela. SKU que outra transação gravou no meio (unique_violation do gatilho/UNIQUE): _estrito (aplicar a prévia)
-- ⇒ P0409 e nada fica; senão (gerar_skus_modelo) ⇒ vira conflito, como no laço da F3.5a.
DECLARE
  v_op jsonb;
  n_criados integer := 0;
  n_atualizados integer := 0;
  n_removidos integer := 0;
  n_manuais integer := 0;
  v_conflitos jsonb := '[]'::jsonb;
BEGIN
  -- A#3 do G-migration: o chamador lê a loja do modelo sob a mesma trava (aplicar/gerar) — aqui só CONFIRMA que bate, em
  -- vez de confiar cegamente no parâmetro (endurecimento; hoje os 2 chamadores já passam a loja certa).
  IF _tenant IS DISTINCT FROM (SELECT mo.tenant_id FROM public.modelos mo WHERE mo.id = _modelo_id) THEN
    RAISE EXCEPTION 'Loja do plano não confere com o modelo.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_op IN SELECT x.value FROM jsonb_array_elements(coalesce(_plano -> 'ops', '[]'::jsonb)) WITH ORDINALITY AS x(value, n)
               ORDER BY x.n LOOP
    -- A#2 do G-migration: op nula/desconhecida pula (antes, NULL NOT IN (...) não pulava e caía no ELSE = 'atualizar').
    CONTINUE WHEN v_op ->> 'op' IS NULL OR v_op ->> 'op' NOT IN ('remover', 'manual', 'inserir', 'atualizar');
    BEGIN
      IF v_op ->> 'op' = 'remover' THEN
        DELETE FROM public.modelo_skus s
         WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id AND NOT s.manual;
        IF FOUND THEN
          n_removidos := n_removidos + 1;
        ELSIF _estrito THEN
          RAISE EXCEPTION 'previa_desatualizada: um SKU que sairia ja nao esta gravado' USING ERRCODE = 'P0409';
        END IF;
      ELSIF v_op ->> 'op' = 'manual' THEN
        IF v_op ->> 'id' IS NULL THEN
          INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
          VALUES (_tenant, _modelo_id, (v_op ->> 'vkey')::uuid, v_op ->> 'tkey', v_op ->> 'sku', true, now());
        ELSE
          UPDATE public.modelo_skus s
             SET sku = v_op ->> 'sku', manual = true, gerado_em = now(), rev = s.rev + 1
           WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id
             AND (v_op ->> 'rev_base' IS NULL OR s.rev = (v_op ->> 'rev_base')::integer);
          IF NOT FOUND THEN
            RAISE EXCEPTION 'conflito_versao: o SKU foi alterado por outra pessoa' USING ERRCODE = 'P0409';
          END IF;
        END IF;
        n_manuais := n_manuais + 1;
      ELSIF v_op ->> 'op' = 'inserir' THEN
        INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
        VALUES (_tenant, _modelo_id, (v_op ->> 'vkey')::uuid, v_op ->> 'tkey', v_op ->> 'sku', false, now());
        n_criados := n_criados + 1;
      ELSIF v_op ->> 'op' = 'atualizar' THEN
        UPDATE public.modelo_skus s
           SET sku = v_op ->> 'sku', gerado_em = now(), rev = s.rev + 1
         WHERE s.id = (v_op ->> 'id')::uuid AND s.modelo_id = _modelo_id AND NOT s.manual;
        IF FOUND THEN
          n_atualizados := n_atualizados + 1;
        ELSIF _estrito THEN
          RAISE EXCEPTION 'previa_desatualizada: um SKU que mudaria ja nao esta como na previa' USING ERRCODE = 'P0409';
        END IF;
      ELSE
        RAISE EXCEPTION 'Operação de SKU desconhecida: %', v_op ->> 'op' USING ERRCODE = 'P0001';
      END IF;
    EXCEPTION WHEN unique_violation THEN
      IF _estrito THEN
        RAISE EXCEPTION 'previa_desatualizada: o SKU % foi gravado em outra linha depois da previa', v_op ->> 'sku'
          USING ERRCODE = 'P0409';
      END IF;
      v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
        'variante_key', v_op -> 'vkey', 'tamanho_key', v_op -> 'tkey', 'sku', v_op -> 'sku',
        'com_modelo_id', NULL::text, 'com_nome', NULL::text, 'com_ref', NULL::text,
        'mensagem', format('SKU %s não gravado: outra pessoa gravou esta linha agora. Gere de novo.', v_op ->> 'sku')));
    END;
  END LOOP;
  RETURN jsonb_build_object('criados', n_criados, 'atualizados', n_atualizados, 'removidos', n_removidos,
                            'manuais', n_manuais, 'conflitos', v_conflitos);
END
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

DO $acl$
DECLARE
  r record;
  v_acl text;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)', '{postgres=X/postgres,service_role=X/postgres}'), ('public._skus_executar_plano(uuid,uuid,jsonb,boolean)', '{postgres=X/postgres,service_role=X/postgres}'), ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}'), ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', '{postgres=X/postgres,service_role=X/postgres}')) AS x(fn, acl) LOOP
    SELECT proacl::text INTO v_acl FROM pg_proc WHERE oid = to_regprocedure(r.fn);
    IF v_acl IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'sku_previa_mensagens_ascii: ACL de % mudou (esperado %, achei %) — esta migration só troca texto de mensagem (invariante #9)', r.fn, r.acl, v_acl USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$acl$;

DO $ascii$
DECLARE
  fn text;
  n_esperado int;
  corpo text;
  sem_comentarios text;
  v_cmd text;
  n_achado int;
BEGIN
  FOR fn, n_esperado IN SELECT * FROM (VALUES ('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)', 3), ('public._skus_executar_plano(uuid,uuid,jsonb,boolean)', 4), ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', 1), ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', 2)) AS x(fn, n) LOOP
    corpo := pg_get_functiondef(to_regprocedure(fn));
    sem_comentarios := regexp_replace(corpo, '--[^\n]*', '', 'g');
    n_achado := 0;
    FOR v_cmd IN
      SELECT m[1] FROM regexp_matches(sem_comentarios, '(RAISE\s+EXCEPTION\y[^;]*;)', 'g') AS m
    LOOP
      CONTINUE WHEN v_cmd NOT LIKE '%P0409%';
      n_achado := n_achado + 1;
      IF octet_length(v_cmd) <> char_length(v_cmd) THEN
        RAISE EXCEPTION 'sku_previa_mensagens_ascii: comando RAISE...P0409 fora de ASCII em % (R2 do G-plano) — %', fn, v_cmd USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
    IF n_achado IS DISTINCT FROM n_esperado THEN
      RAISE EXCEPTION 'sku_previa_mensagens_ascii: % tem % comando(s) RAISE...P0409 (esperado %) — o cheque ASCII (R2) não pode ficar vazio', fn, n_achado, n_esperado USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$ascii$;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._aplicar_skus_modelo_core(uuid,jsonb,text,text)')));
  IF v_md5 IS DISTINCT FROM 'fd7ac0cf1b778711ac2098d41e16ead6' THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: pos-condicao falhou — _aplicar_skus_modelo_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._skus_executar_plano(uuid,uuid,jsonb,boolean)')));
  IF v_md5 IS DISTINCT FROM '2f4ec047824edbdcf53f7fa9b7e9accb' THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: pos-condicao falhou — _skus_executar_plano nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)')));
  IF v_md5 IS DISTINCT FROM '53ab6f802117489e1f794aa411e755ba' THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: pos-condicao falhou — salvar_terceirizados nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)')));
  IF v_md5 IS DISTINCT FROM '8ce76165ffa3ae67d5cdb12eb95bb620' THEN
    RAISE EXCEPTION 'sku_previa_mensagens_ascii: pos-condicao falhou — _salvar_cq_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) — desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
