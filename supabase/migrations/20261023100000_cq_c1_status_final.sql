-- Achados MEDIOS, release R13 (CQ; so banco, sem site): a regra [C1] vale pelo STATUS FINAL + rebaixa do Direcionamento.
--   prod #4  _salvar_cq_core: o [C1] ("nao confirmar com 0 pecas", Sigma da Grade Real = 0) so rodava no clique
--            "Confirmar" (IF _confirmar). Agora roda quando o status FINAL do save e 'confirmado' - tambem no Salvar
--            de um CQ ja confirmado (front: expedicao.cq.$modeloId.tsx saveCq(false)). Recusa com a MESMA mensagem
--            P0001 em PT de hoje (P0001 = 400 no PostgREST; acento permitido - reference_raise_5xx_ascii); o
--            mensagemErro mostra a propria mensagem. O status/v_confirmado_at so foram calculados ANTES do [C1].
--            salvar_terceirizados (P-192 A, dono 01/out): depois do _aplicar_reais_do_grade_detalhe (CQ confirmado
--            + bloco-fonte), se a Grade Real da fonte ficou Sigma = 0 (mesma conta do [C1] com fonte), o salvar do
--            PCP NAO e recusado: o CQ volta a PENDENTE (o Pos confirmado volta junto, precedente [M2] do
--            _desmarcar_cq_core) + #Erro na etapa 'cq' (modelos.revisao_pendente.cq). O gatilho
--            trg_rebaixa_lancado_cq (abaixo) rebaixa Lancado e Direcionamento.
--            [fix round 1, G-MIGRATION L1] trava o CQ do cad logo depois do advisory lock (FOR UPDATE; sem CQ = no-op):
--            mesma ordem das RPCs do CQ (controle_qualidade -> bloco-fonte), sem deadlock com o rebaixamento.
--            [L3] o #Erro 'cq' so acende se o UPDATE do CQ pegou a linha (IF FOUND).
--   prod #5  fn_rebaixa_lancado_cq (funcao do gatilho trg_rebaixa_lancado_cq; o gatilho NAO muda): saia cedo se o
--            modelo nao estava lancado. Agora, quando o CQ deixa de estar liberado (Pre ou Pos), alem do lancado,
--            cad.direcionamento_status separado -> pendente (direcionamento_confirmado_at = NULL) + #Erro
--            'direcionamento' - mesmo gate de fn_rebaixa_direcionamento_grade (legado OU direcionamento_lojas,
--            invariante #10). Vale para modelo lancado e nao lancado.
--            [fix round 1, L2] o ramo do Direcionamento usa NOT _cq_liberado(NEW.cad_id) - o MESMO predicado do
--            Confirmar do Direcionamento (bloco pos com ativo NULL conta como pos); o ramo do lancado segue igual.
-- As funcoes so agem num save/gatilho futuro: nada gravado muda na ida. Passo 0 de producao (01/out 11:06): CQ
-- confirmado com Sigma = 0 -> 0; direcionamento separado sem CQ liberado -> 0 (copia: 0 e 0).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06) - md5 "antes" da copia 54422 = producao.
--   public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)
--     ANTES  8ce76165ffa3ae67d5cdb12eb95bb620  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 2fbf741d11b7f0131a99999e2f45fcf4  (este arquivo; reaplicar = no-op)
--   public.salvar_terceirizados(uuid,jsonb,text,jsonb)
--     ANTES  53ab6f802117489e1f794aa411e755ba  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS e5a6f830516e463911529664a4940883  (este arquivo; reaplicar = no-op)
--   public.fn_rebaixa_lancado_cq()
--     ANTES  ad991b81358029c2df58c05042f228d5  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     DEPOIS 4aea9a4ec6083c8445ac86e92f88b049  (este arquivo; reaplicar = no-op)
--   Sem mudanca (so guarda):
--     public._aplicar_reais_do_grade_detalhe(uuid,uuid)   00f804865d9ad71c41c37351dc06178c  INTOCADA  -- CONFIRMADO: Passo 0 (01/out 11:06)
--     public._cq_liberado(uuid)                            55a5f7ad704a061087e0fc154d4605e7  INTOCADA (chamada pelo gatilho)  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R13
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto da propria funcao; nada em tabela, nada em auth/storage).
-- Sem DDL de tabela, sem DROP, sem DROP TRIGGER, sem funcao nova. ACL: CREATE OR REPLACE mantem a de hoje, e a
-- pos-condicao confere que ficou IDENTICA (proacl antes = depois) e ainda: _salvar_cq_core e
-- _aplicar_reais_do_grade_detalhe sem EXECUTE para PUBLIC/anon/authenticated (inv. #9); salvar_terceirizados (RPC
-- publica do PCP) segue COM authenticated e SEM PUBLIC/anon; fn_rebaixa_lancado_cq (RETURNS trigger, nao chamavel
-- como RPC) mantem a ACL de hoje (PUBLIC/anon/authenticated com EXECUTE - pre-existente, igual em producao).
-- Volta: supabase/rollback/20261023100000_cq_c1_status_final_down.sql (devolve os 3 textos de antes, com guarda dos
-- de depois). LIFO: 20261006120000_sku_previa_mensagens_ascii_down.sql:33-42 confere _salvar_cq_core 8ce76165 e
-- salvar_terceirizados 53ab6f80 -> o inverso DESTA release roda ANTES daquele (e reaplicar a ida 20261006120000
-- exige desfazer esta antes). Nenhum outro inverso confere estes md5 (grep em supabase/rollback).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _r13_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _r13_md5_aceitos VALUES
  ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', '8ce76165ffa3ae67d5cdb12eb95bb620', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)', '2fbf741d11b7f0131a99999e2f45fcf4', 'depois'),
  ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', '53ab6f802117489e1f794aa411e755ba', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', 'e5a6f830516e463911529664a4940883', 'depois'),
  ('public.fn_rebaixa_lancado_cq()', 'ad991b81358029c2df58c05042f228d5', 'antes'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public.fn_rebaixa_lancado_cq()', '4aea9a4ec6083c8445ac86e92f88b049', 'depois'),
  ('public._aplicar_reais_do_grade_detalhe(uuid,uuid)', '00f804865d9ad71c41c37351dc06178c', 'dep'),  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
  ('public._cq_liberado(uuid)', '55a5f7ad704a061087e0fc154d4605e7', 'dep');  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R13

-- ACL de antes (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r13_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _r13_md5_aceitos a;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _r13_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'medios_r13: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _r13_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'medios_r13: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

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

  -- Status FINAL deste save (calculado ANTES do [C1]): confirmar, ou editar um CQ já confirmado.
  SELECT id, status INTO v_cq_id, v_status_atual FROM public.controle_qualidade WHERE cad_id = _cad_id;

  v_status := CASE
    WHEN _confirmar THEN 'confirmado'
    WHEN v_cq_id IS NOT NULL THEN COALESCE(v_status_atual, 'pendente')
    ELSE 'pendente'
  END;
  v_confirmado_at := CASE WHEN v_status = 'confirmado' THEN now() ELSE NULL END;

  -- [C1] status final confirmado exige ter contado ao menos 1 peça (Σ da Grade Real > 0) — vale
  -- no clique "Confirmar" E no Salvar de um CQ já confirmado (medios R13, prod #4). COM fonte: Σ
  -- max(0, recebida−defeito) sobre as células do grade_detalhe (a MESMA fonte da Grade Real
  -- gravada). SEM fonte: Σ do _reais do cliente (comportamento atual).
  IF v_status = 'confirmado' THEN
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
  v_fonte uuid; v_cq_conf boolean; v_total_real int;
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
  -- (medios R13, prod #5) sem a saída cedo por "não lançado": o Direcionamento também rebaixa.

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

  -- prod #5: o Direcionamento separado se apoiava no CQ liberado (_cq_liberado no Confirmar) →
  -- volta a 'pendente' + #Erro 'direcionamento'. Usa o MESMO predicado do Confirmar
  -- (_cq_liberado, que neste gatilho AFTER já vê a linha NEW — L2: bloco pós com ativo NULL
  -- conta como pós). Mesmo gate do fn_rebaixa_direcionamento_grade (olha as DUAS tabelas,
  -- legado e novo — invariante #10).
  IF NOT public._cq_liberado(NEW.cad_id) THEN
    IF EXISTS (
      SELECT 1 FROM public.cad c
       WHERE c.id = NEW.cad_id
         AND c.direcionamento_status = 'separado'
         AND (
           EXISTS (SELECT 1 FROM public.direcionamento d WHERE d.cad_id = NEW.cad_id)
           OR EXISTS (SELECT 1 FROM public.direcionamento_lojas dl WHERE dl.cad_id = NEW.cad_id)
         )
    ) THEN
      UPDATE public.cad
         SET direcionamento_status = 'pendente', direcionamento_confirmado_at = NULL
       WHERE id = NEW.cad_id AND direcionamento_status = 'separado';
      UPDATE public.modelos
         SET revisao_pendente = COALESCE(revisao_pendente, '{}'::jsonb) || '{"direcionamento": true}'::jsonb
       WHERE id = v_modelo;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _r13_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'medios_r13: pos-condicao falhou - % nao ficou com o texto esperado (%, md5 %)', r.assinatura, r.papel, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ACL identica a de antes (CREATE OR REPLACE nao mexe; conferido).
  FOR r IN SELECT assinatura, acl FROM _r13_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r13: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)'),
                                 ('public._aplicar_reais_do_grade_detalhe(uuid,uuid)'),
                                 ('public._cq_liberado(uuid)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r13: % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r13: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- salvar_terceirizados: RPC publica do PCP - authenticated SIM; anon e PUBLIC NAO (como hoje).
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r13: salvar_terceirizados perdeu o EXECUTE de authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.salvar_terceirizados(uuid,jsonb,text,jsonb)')
                   AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r13: salvar_terceirizados ficou executavel por anon/PUBLIC' USING ERRCODE = 'P0001';
  END IF;
  -- o gatilho continua o mesmo, ligado a funcao (nao foi recriado).
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgname = 'trg_rebaixa_lancado_cq' AND t.tgrelid = to_regclass('public.controle_qualidade')
                    AND t.tgfoid = to_regprocedure('public.fn_rebaixa_lancado_cq()') AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'medios_r13: gatilho trg_rebaixa_lancado_cq ausente ou desligado' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
