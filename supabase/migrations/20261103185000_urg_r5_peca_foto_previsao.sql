-- Urgentes R5 - previsao de entrega da peca de foto (producao_terceirizados.peca_foto_previsao). GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 3 / R5; Ruling 3).
-- O que muda:
--   1) coluna NOVA public.producao_terceirizados.peca_foto_previsao date NULL (sem default, sem reescrita) = PREVISAO de
--      entrega da peca de foto; peca_foto_data passa a ser a data REAL (entregue) - dados antigos ficam. Sem GRANT: a tela
--      grava pela RPC; authenticated segue so com SELECT na tabela (S3b), anon sem nada (S5).
--   2) salvar_terceirizados (wrapper da tela; ANTES = o da Camada C1, fe253087) grava a coluna: chave PRESENTE = grava
--      ('' / null = NULL); chave AUSENTE = MANTEM o gravado (aba/site antigo nao apaga a previsao - Ruling 3; excecao ao
--      estado completo SO nesta coluna); bloco NOVO sem a chave = NULL. Nada mais muda (portao S3b, C1/I2, _molde_tocado,
--      estado completo so nas linhas ATIVAS).
-- ACL, SECURITY e search_path ficam iguais (CREATE OR REPLACE preserva; pos-condicao confere). Nenhum dado muda.
-- Trava: ADD COLUMN = AccessExclusiveLock em producao_terceirizados (ms; coluna nullable sem default = so catalogo) ate o
-- COMMIT. MEDIDO na copia local (supautils carregado, por diferenca de pg_locks, txn revertida): ALTER+COMMENT ~4 ms;
-- travas novas = SO producao_terceirizados (AccessExclusive + ShareUpdateExclusive); NENHUMA em auth/storage/realtime.
-- Enquanto a txn dura: leitura e escrita de servicos (PCP, Etapas PL, Financeiro de servicos) esperam. HORARIO CALMO.
-- lock_timeout 1500ms; 55P03 = nada mudou, rodar o arquivo de novo. Idempotente (ADD COLUMN IF NOT EXISTS).
-- Aba aberta antes do deploy segue funcionando (nao manda a chave -> mantem).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.salvar_terceirizados(uuid,jsonb,text,jsonb)
--     ANTES  fe2530878c26ae9a9680a7b1d02eca71
--     DEPOIS 388454fc81028e43d60878fa75132db2
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103185000_urg_r5_peca_foto_previsao_down.sql - DEPOIS do 20261103190000_down (r8a) e ANTES do 20261103181000_down
-- (r4b; pela ordem do kit) e, OBRIGATORIO, ANTES do 20261103160000_down da Camada C1 (exige salvar_terceirizados =
-- fe253087) - e, atras dele, do S3b 20261101130000_down e do 20261023100000_down (ver mig/md5-b.txt).
-- DROP da coluna: supabase/rollback/20261103185000_urg_r5_peca_foto_previsao_down_drop.sql (opcional, depois, horario calmo, site ja voltado).
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
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', 'fe2530878c26ae9a9680a7b1d02eca71', '388454fc81028e43d60878fa75132db2')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r5: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'producao_terceirizados'
                AND column_name = 'peca_foto_previsao' AND data_type <> 'date') THEN
    RAISE EXCEPTION 'urg_r5: producao_terceirizados.peca_foto_previsao existe com outro tipo' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- [urg r5] coluna nova: nullable, sem default (sem reescrita). Sem GRANT: a tela grava pela RPC (o cliente so LE a tabela
-- desde a S3b); peca_foto_data passa a ser a data REAL (entregue) - os dados antigos ficam.
ALTER TABLE public.producao_terceirizados ADD COLUMN IF NOT EXISTS peca_foto_previsao date;
COMMENT ON COLUMN public.producao_terceirizados.peca_foto_previsao IS
  'Previsao de entrega da peca de foto (R5). Gravada so por salvar_terceirizados (chave ausente = mantem); peca_foto_data = data entregue.';

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

  -- [camada C1 / P-77 A] estado completo VAZIO com servicos no servidor = recusa (nada e apagado), a nao ser com a marca
  -- explicita "apagar tudo" (_rev_base->'_apagar_tudo' = N, a contagem que a pessoa confirmou em "Apagar todos os N servicos?").
  IF (CASE jsonb_typeof(COALESCE(_blocos, '[]'::jsonb)) WHEN 'array' THEN jsonb_array_length(COALESCE(_blocos, '[]'::jsonb)) = 0 ELSE true END)
     AND EXISTS (SELECT 1 FROM public.producao_terceirizados WHERE cad_id = _cad_id AND ativo IS TRUE) THEN
    IF COALESCE(_rev_base->>'_apagar_tudo', '') !~ '^[0-9]{1,9}$' THEN
      RAISE EXCEPTION 'estado_vazio_recusado: servicos %',
        (SELECT count(*) FROM public.producao_terceirizados WHERE cad_id = _cad_id AND ativo IS TRUE) USING ERRCODE = 'P0001';
    ELSIF (SELECT count(*) FROM public.producao_terceirizados WHERE cad_id = _cad_id AND ativo IS TRUE) <> (_rev_base->>'_apagar_tudo')::int THEN
      -- [camada C1 / M1] a pessoa confirmou apagar N; o servidor tem outro numero (alguem criou/apagou servico no meio)
      RAISE EXCEPTION 'conflito_versao: a lista de servicos mudou depois da confirmacao de apagar tudo' USING ERRCODE = 'P0409';
    END IF;
  END IF;

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
          peca_foto_data = NULLIF(b->>'peca_foto_data','')::date,
          -- [urg r5] previsao de entrega da peca de foto: chave AUSENTE (aba/site antigo) mantem o gravado
          peca_foto_previsao = CASE WHEN b ? 'peca_foto_previsao' THEN NULLIF(b->>'peca_foto_previsao','')::date ELSE peca_foto_previsao END
        WHERE id = (b->>'id')::uuid AND cad_id = _cad_id;
        v_id := (b->>'id')::uuid;
      ELSE
        INSERT INTO public.producao_terceirizados (
          cad_id, categoria_terceirizado_id, interno, empresa_id, representante_id,
          colaborador_id, ativo, preco_metro_unidade, quantidade_enviada, quantidade_recebida,
          quantidade_defeito, desconto_total, multa_total, numero_parcelas,
          data_enviado, data_prevista, data_entregue, observacao, aviamentos_enviados, tecidos_enviados,
          detalhado, grade_detalhe, pt_data_saida, pt_data_entrada, pt_aprovacao, nf_saida, nf_entrada,
          peca_foto, peca_foto_data, peca_foto_previsao
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
          COALESCE((b->>'peca_foto')::boolean, false), NULLIF(b->>'peca_foto_data','')::date,
          NULLIF(b->>'peca_foto_previsao','')::date  -- [urg r5]
        ) RETURNING id INTO v_id;
      END IF;
      v_ids := array_append(v_ids, v_id);
    END LOOP;
  END IF;

  -- [camada C1 / I2] blocos que este Salvar vai APAGAR: o cliente manda em _rev_base o rev de TODO bloco da base dele (inclusive
  -- os removidos). Apagar bloco cujo rev mudou desde a base (outra pessoa editou) ou que o cliente nunca viu (criado por outra
  -- pessoa depois da carga) = P0409 e nada muda. _rev_base null = bypass (compat/manutencao, como a trava por bloco acima).
  -- [Follow-up 2] o Salvar de estado completo opera SO nas linhas ATIVAS: linha ativo = false nunca e conferida nem apagada.
  IF jsonb_typeof(_rev_base) = 'object' THEN
    DECLARE v_del record;
    BEGIN
      FOR v_del IN SELECT pt.id, pt.rev FROM public.producao_terceirizados pt
                    WHERE pt.cad_id = _cad_id AND pt.ativo IS TRUE AND NOT (pt.id = ANY(v_ids)) ORDER BY pt.id FOR UPDATE LOOP
        IF (_rev_base->>v_del.id::text) IS NULL OR v_del.rev IS DISTINCT FROM (_rev_base->>v_del.id::text)::int THEN
          RAISE EXCEPTION 'conflito_versao: um servico removido foi alterado ou criado por outra pessoa'
            USING ERRCODE = 'P0409';
        END IF;
      END LOOP;
    END;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.producao_terceirizados pt
    JOIN public.parcelas_servico ps ON ps.producao_terceirizado_id = pt.id
    WHERE pt.cad_id = _cad_id AND pt.ativo IS TRUE AND NOT (pt.id = ANY(v_ids))
      AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
  ) THEN
    -- [camada C1 / P-268 A] prefixo ASCII + QUAIS servicos/parcelas (a tela traduz: erro-mensagem.ts mensagemCamada).
    RAISE EXCEPTION 'servico_com_parcela_paga: %', (
      SELECT string_agg(x.rotulo || ': parcela ' || x.parcelas, '; ' ORDER BY x.rotulo)
        FROM (SELECT concat_ws(' - ', COALESCE(ct.nome, 'sem categoria'), COALESCE(e.nome_fantasia, co.nome)) AS rotulo,
                     string_agg(ps.numero_parcela::text, ', ' ORDER BY ps.numero_parcela) AS parcelas
                FROM public.producao_terceirizados pt
                JOIN public.parcelas_servico ps ON ps.producao_terceirizado_id = pt.id
                LEFT JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
                LEFT JOIN public.empresas e ON e.id = pt.empresa_id
                LEFT JOIN public.colaboradores co ON co.id = pt.colaborador_id
               WHERE pt.cad_id = _cad_id AND pt.ativo IS TRUE AND NOT (pt.id = ANY(v_ids))
                 AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL)
               GROUP BY pt.id, ct.nome, e.nome_fantasia, co.nome) x
    ) USING ERRCODE = 'P0001';
  END IF;

  -- [camada C1 / Follow-up 2] estado completo opera so nas linhas ATIVAS: servico inativo (ativo = false) nunca e apagado aqui.
  DELETE FROM public.producao_terceirizados WHERE cad_id = _cad_id AND ativo IS TRUE AND NOT (id = ANY(v_ids));

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

  -- [camada C1 / I3] Observacao de Partes do Molde (cad.observacoes_molde) sem lost update: a tela manda em _rev_base
  -- '_molde_tocado' (bool) e '_molde_base' (o texto que ela carregou). Nao tocado = nao grava (o valor gravado por outra pessoa,
  -- Oficina ou outra aba, fica); tocado e o servidor mudou desde a base = P0409. Sem a chave (cliente antigo, edicao rapida que
  -- rele o valor, _rev_base null) = grava como antes.
  IF jsonb_typeof(_rev_base) = 'object' AND (_rev_base ? '_molde_tocado') THEN
    IF COALESCE(_rev_base->>'_molde_tocado', '') = 'true' THEN
      PERFORM 1 FROM public.cad WHERE id = _cad_id FOR NO KEY UPDATE;  -- B-1: o mesmo nivel do UPDATE (nao espera FOR KEY SHARE)
      IF (SELECT COALESCE(c.observacoes_molde, '') FROM public.cad c WHERE c.id = _cad_id)
         IS DISTINCT FROM COALESCE(_rev_base->>'_molde_base', '') THEN
        RAISE EXCEPTION 'conflito_versao: observacoes_molde' USING ERRCODE = 'P0409';
      END IF;
      UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
    END IF;
  ELSE
    UPDATE public.cad SET observacoes_molde = NULLIF(_observacoes_molde, '') WHERE id = _cad_id;
  END IF;
END;
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'producao_terceirizados'
                   AND column_name = 'peca_foto_previsao' AND data_type = 'date' AND is_nullable = 'YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'urg_r5: pos-condicao falhou na coluna producao_terceirizados.peca_foto_previsao' USING ERRCODE = 'P0001';
  END IF;
  IF has_column_privilege('authenticated', 'public.producao_terceirizados', 'peca_foto_previsao', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.producao_terceirizados', 'peca_foto_previsao', 'INSERT')
     OR has_column_privilege('anon', 'public.producao_terceirizados', 'peca_foto_previsao', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r5: pos-condicao falhou nos privilegios da coluna peca_foto_previsao' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.salvar_terceirizados(uuid,jsonb,text,jsonb)', '388454fc81028e43d60878fa75132db2', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r5: pos-condicao falhou em % (wrapper; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r5: pos-condicao falhou na ACL/secdef/search_path de % (wrapper)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
