-- INVERSO de supabase/migrations/20261027130000_ref_revelar_ao_mudar_etapa.sql (achados LEVES L3, kanban #21, P-211 A).
-- Devolve o salvar_config_loja da 20261027110000 (Salvar da etapa da REF volta a so gravar a etapa, sem revelar e sem a recusa
-- 'ref_etapa_com_kanban:') e DROPa as 3 funcoes novas (DROP FUNCTION so pega a trava de objeto da propria funcao). REFs ja
-- reveladas FICAM (inv. #11). Guarda: as 4 com o texto da ida; outro -> P0001 e nada muda (2a execucao = recusada).
-- ORDEM: SITE PRIMEIRO (o site novo chama ref_previa_revelar). LIFO: DEPOIS do 20261027140000_down e antes do 110000_down.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l3vd_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'), ('public._ref_exibir_gate_etapa(uuid,text,text)'), ('public._ref_revelar_candidatos(uuid,text)'), ('public.ref_previa_revelar(uuid,text)')) v(s);

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  IF to_regprocedure('public.fn_modelo_ref_auto()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_ref_auto()'))) = '6d68b20b0e5086a9a9dc0c87a8b42c69' THEN
    RAISE EXCEPTION 'leves_l3 (volta): a 20261027140000 ainda esta aplicada - rode antes o 20261027140000_down (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', '2d43c259135119b345a09a894091c2b5'),
      ('public._ref_exibir_gate_etapa(uuid,text,text)', '99342e2e1ea3c4c43a2d0943b2c0bdc3'),
      ('public._ref_revelar_candidatos(uuid,text)', '44bc4271c09322a793247259843c1a67'),
      ('public.ref_previa_revelar(uuid,text)', '6a9da1726b5f7fcdcf8be85512b9cece')) v(s, m) LOOP
    v_md5 := CASE WHEN to_regprocedure(r.s) IS NULL THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure(r.s))) END;
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l3 (volta): % nao esta com o texto da ida (md5 %) - nada a desfazer, ja desfeita ou outra frente mexeu', r.s, coalesce(v_md5, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public.salvar_config_loja(_tenant_id uuid, _mudancas jsonb, _base jsonb, _chave_kanban_esperada boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  c_permitidas constant text[] := ARRAY[
    'timezone', 'modo_baixa_estoque', 'modo_oc_rolo', 'explosao_envio_status', 'ref_exibir_status',
    'markup_analise_faixa', 'leadtime', 'pcp_etapas', 'revenda_campos', 'ref_config', 'keywords', 'status_kanban',
    'kanban_requisitos', 'kanban_requisitos_excecoes', 'revenda_kanban_colunas', 'revenda_kanban_requisitos',
    'tab_labels', 'campos_editaveis'];
  c_kanban constant text[] := ARRAY[
    'status_kanban', 'kanban_requisitos', 'kanban_requisitos_excecoes', 'revenda_kanban_colunas',
    'revenda_kanban_requisitos'];
  v_tenant uuid;
  v_m jsonb := _mudancas;
  v_k text;
  v_v jsonb;
  v_t text;
  v_mn jsonb;              -- _mudancas NORMALIZADO (o que de fato vai para a coluna)
  v_criada integer := 0;
  v_n integer := 0;
  v_row jsonb;
  v_new jsonb;
  v_conf text[] := ARRAY[]::text[];
  v_gravadas text[];
  v_valores jsonb := '{}'::jsonb;
  v_sig text;
BEGIN
  -- 1. Autorização
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode salvar a Configuração da Loja.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = c_nil THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode salvar a Configuração da Loja.' USING ERRCODE = '42501';
  END IF;
  IF _tenant_id IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'A loja ativa mudou. Recarregue a página antes de salvar.' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lista branca + base obrigatória por chave
  IF v_m IS NULL OR jsonb_typeof(v_m) <> 'object' OR _base IS NULL OR jsonb_typeof(_base) <> 'object' THEN
    RAISE EXCEPTION 'Dados inválidos para salvar a Configuração da Loja. Recarregue a página e tente de novo.'
      USING ERRCODE = 'P0001';
  END IF;
  FOR v_k IN SELECT k FROM jsonb_object_keys(v_m) AS j(k) LOOP
    IF NOT (v_k = ANY (c_permitidas)) THEN
      RAISE EXCEPTION 'O campo "%" não pode ser salvo pela Configuração da Loja.', v_k USING ERRCODE = 'P0001';
    END IF;
    IF NOT (_base ? v_k) THEN
      RAISE EXCEPTION 'Falta o valor carregado do campo "%". Recarregue a página e tente de novo.', v_k
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- 3. Validação por coluna (tipo JSON, NOT NULL, domínios)
  FOR v_k, v_v IN SELECT j.key, j.value FROM jsonb_each(v_m) AS j LOOP
    v_t := jsonb_typeof(v_v);
    CASE v_k
      WHEN 'timezone' THEN
        IF v_t <> 'string' OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = v_v #>> '{}') THEN
          RAISE EXCEPTION 'Fuso horário inválido: %.', coalesce(v_v #>> '{}', 'vazio') USING ERRCODE = 'P0001';
        END IF;
      WHEN 'modo_baixa_estoque' THEN
        IF v_t <> 'string' OR NOT (v_v #>> '{}' = ANY (ARRAY['por_oc', 'automatico'])) THEN
          RAISE EXCEPTION 'Modo de baixa de estoque inválido: %.', coalesce(v_v #>> '{}', 'vazio') USING ERRCODE = 'P0001';
        END IF;
      WHEN 'modo_oc_rolo' THEN
        IF v_t <> 'string' OR NOT (v_v #>> '{}' = ANY (ARRAY['oc', 'rolo', 'ambos'])) THEN
          RAISE EXCEPTION 'Modo de OC/rolo inválido: %.', coalesce(v_v #>> '{}', 'vazio') USING ERRCODE = 'P0001';
        END IF;
      WHEN 'explosao_envio_status', 'ref_exibir_status', 'keywords' THEN
        IF v_t NOT IN ('string', 'null') THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'markup_analise_faixa' THEN
        IF v_t <> 'boolean' THEN
          RAISE EXCEPTION 'O campo "%" precisa ser verdadeiro ou falso.', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'leadtime', 'ref_config' THEN
        IF v_t NOT IN ('object', 'null') THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
        -- leves L3 kanban #18: Formato da REF com montagem (partes) exige a parte "numero" (sem ela a REF nao tem numero e a
        -- re-sincronizacao do fn_modelo_ref_auto consome um numero novo a cada vez); sigla configurada de taxonomia = so
        -- letras (digito colado no numero era engolido). Recusas ASCII com prefixo (a tela traduz: erro-mensagem.ts).
        IF v_k = 'ref_config' AND v_t = 'object' THEN
          IF jsonb_typeof(v_v -> 'partes') IS NOT NULL AND jsonb_typeof(v_v -> 'partes') <> 'null'
             AND (jsonb_typeof(v_v -> 'partes') <> 'array' OR NOT ((v_v -> 'partes') ? 'numero')) THEN
            RAISE EXCEPTION 'ref_formato_sem_numero: o formato da REF precisa da parte numero' USING ERRCODE = 'P0001';
          END IF;
          IF jsonb_typeof(v_v -> 'sigla_taxonomia') = 'object' THEN
            v_sig := NULL;
            SELECT s.value INTO v_sig
              FROM jsonb_each_text(v_v -> 'sigla_taxonomia') AS s(key, value)
             WHERE s.value ~ '[0-9]'
             ORDER BY s.key
             LIMIT 1;
            IF v_sig IS NOT NULL THEN
              RAISE EXCEPTION 'ref_sigla_com_digito: %', v_sig USING ERRCODE = 'P0001';
            END IF;
          END IF;
          -- [fix round 1, B6] sigla de FAMILIA tambem so letras (mesma recusa, mesma ordem: a 1a pela chave).
          IF jsonb_typeof(v_v -> 'sigla_familia') = 'object' THEN
            v_sig := NULL;
            SELECT s.value INTO v_sig
              FROM jsonb_each_text(v_v -> 'sigla_familia') AS s(key, value)
             WHERE s.value ~ '[0-9]'
             ORDER BY s.key
             LIMIT 1;
            IF v_sig IS NOT NULL THEN
              RAISE EXCEPTION 'ref_sigla_com_digito: %', v_sig USING ERRCODE = 'P0001';
            END IF;
          END IF;
        END IF;
      WHEN 'pcp_etapas', 'status_kanban' THEN
        IF v_t NOT IN ('array', 'null') THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'revenda_kanban_colunas' THEN
        IF v_t = 'null' THEN
          RAISE EXCEPTION 'O campo "%" não pode ficar vazio.', v_k USING ERRCODE = 'P0001';
        ELSIF v_t <> 'array' THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      ELSE
        -- revenda_campos, kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_requisitos, tab_labels,
        -- campos_editaveis: objeto obrigatório
        IF v_t = 'null' THEN
          RAISE EXCEPTION 'O campo "%" não pode ficar vazio.', v_k USING ERRCODE = 'P0001';
        ELSIF v_t <> 'object' THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
    END CASE;
  END LOOP;

  -- Nada a gravar: não cria linha nem trava nada.
  SELECT coalesce(array_agg(k ORDER BY k), ARRAY[]::text[]) INTO v_gravadas FROM jsonb_object_keys(v_m) AS j(k);
  IF cardinality(v_gravadas) = 0 THEN
    RETURN jsonb_build_object('gravadas', '[]'::jsonb, 'valores', '{}'::jsonb);
  END IF;

  -- Normalização única (usada no compare-and-set E no UPDATE): keywords com btrim; só espaços → null.
  v_mn := v_m;
  IF v_mn ? 'keywords' THEN
    v_mn := jsonb_set(v_mn, '{keywords}',
                      coalesce(to_jsonb(nullif(btrim(coalesce(v_m ->> 'keywords', '')), '')), 'null'::jsonb));
  END IF;

  -- 4. Trava a linha da loja PRIMEIRO; só se não existe, cria (defaults) e relê travada
  SELECT to_jsonb(tc) INTO v_row FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant FOR UPDATE;
  IF v_row IS NULL THEN
    INSERT INTO public.tenant_config (tenant_id) VALUES (v_tenant) ON CONFLICT (tenant_id) DO NOTHING;
    GET DIAGNOSTICS v_criada = ROW_COUNT;
    SELECT to_jsonb(tc) INTO v_row FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant FOR UPDATE;
    IF v_row IS NULL THEN
      RAISE EXCEPTION 'conflito_versao: config_loja' USING ERRCODE = 'P0409', DETAIL = array_to_string(v_gravadas, ',');
    END IF;
  END IF;

  -- 5. Chave do kanban automático: quem mexe no kanban tem de saber em que estado a chave estava
  IF v_m ?| c_kanban THEN
    IF _chave_kanban_esperada IS NULL THEN
      RAISE EXCEPTION 'Recarregue a página antes de salvar o Kanban (estado da chave do Kanban automático não informado).'
        USING ERRCODE = 'P0001';
    END IF;
    IF _chave_kanban_esperada IS DISTINCT FROM coalesce((v_row ->> 'kanban_automatico')::boolean, false) THEN
      RAISE EXCEPTION 'chave_kanban_mudou: a chave do kanban mudou' USING ERRCODE = 'P0409';
    END IF;
  END IF;

  -- 6. Compare-and-set por coluna (linha recém-criada não tem o que comparar); convergido = contra o valor NORMALIZADO
  IF v_criada = 0 THEN
    FOREACH v_k IN ARRAY v_gravadas LOOP
      IF coalesce(v_row -> v_k, 'null'::jsonb) IS DISTINCT FROM coalesce(_base -> v_k, 'null'::jsonb)
         AND coalesce(v_row -> v_k, 'null'::jsonb) IS DISTINCT FROM coalesce(v_mn -> v_k, 'null'::jsonb) THEN
        v_conf := v_conf || v_k;
      END IF;
    END LOOP;
    IF cardinality(v_conf) > 0 THEN
      RAISE EXCEPTION 'conflito_versao: config_loja' USING ERRCODE = 'P0409', DETAIL = array_to_string(v_conf, ',');
    END IF;
  END IF;

  -- 7. UPDATE estático: só as colunas enviadas mudam (as demais ficam como estão)
  UPDATE public.tenant_config SET
    timezone = CASE WHEN v_m ? 'timezone' THEN v_m ->> 'timezone' ELSE timezone END,
    modo_baixa_estoque = CASE WHEN v_m ? 'modo_baixa_estoque' THEN v_m ->> 'modo_baixa_estoque' ELSE modo_baixa_estoque END,
    modo_oc_rolo = CASE WHEN v_m ? 'modo_oc_rolo' THEN v_m ->> 'modo_oc_rolo' ELSE modo_oc_rolo END,
    explosao_envio_status = CASE WHEN v_m ? 'explosao_envio_status' THEN v_m ->> 'explosao_envio_status'
                                 ELSE explosao_envio_status END,
    ref_exibir_status = CASE WHEN v_m ? 'ref_exibir_status' THEN v_m ->> 'ref_exibir_status' ELSE ref_exibir_status END,
    markup_analise_faixa = CASE WHEN v_m ? 'markup_analise_faixa' THEN (v_m ->> 'markup_analise_faixa')::boolean
                                ELSE markup_analise_faixa END,
    leadtime = CASE WHEN v_m ? 'leadtime' THEN nullif(v_m -> 'leadtime', 'null'::jsonb) ELSE leadtime END,
    pcp_etapas = CASE WHEN v_m ? 'pcp_etapas' THEN nullif(v_m -> 'pcp_etapas', 'null'::jsonb) ELSE pcp_etapas END,
    revenda_campos = CASE WHEN v_m ? 'revenda_campos' THEN v_m -> 'revenda_campos' ELSE revenda_campos END,
    ref_config = CASE WHEN v_m ? 'ref_config' THEN nullif(v_m -> 'ref_config', 'null'::jsonb) ELSE ref_config END,
    keywords = CASE WHEN v_m ? 'keywords' THEN v_mn ->> 'keywords' ELSE keywords END,
    status_kanban = CASE WHEN v_m ? 'status_kanban' THEN nullif(v_m -> 'status_kanban', 'null'::jsonb)
                         ELSE status_kanban END,
    kanban_requisitos = CASE WHEN v_m ? 'kanban_requisitos' THEN v_m -> 'kanban_requisitos' ELSE kanban_requisitos END,
    kanban_requisitos_excecoes = CASE WHEN v_m ? 'kanban_requisitos_excecoes' THEN v_m -> 'kanban_requisitos_excecoes'
                                      ELSE kanban_requisitos_excecoes END,
    revenda_kanban_colunas = CASE WHEN v_m ? 'revenda_kanban_colunas' THEN v_m -> 'revenda_kanban_colunas'
                                  ELSE revenda_kanban_colunas END,
    revenda_kanban_requisitos = CASE WHEN v_m ? 'revenda_kanban_requisitos' THEN v_m -> 'revenda_kanban_requisitos'
                                     ELSE revenda_kanban_requisitos END,
    tab_labels = CASE WHEN v_m ? 'tab_labels' THEN v_m -> 'tab_labels' ELSE tab_labels END,
    campos_editaveis = CASE WHEN v_m ? 'campos_editaveis' THEN v_m -> 'campos_editaveis' ELSE campos_editaveis END
  WHERE tenant_id = v_tenant
  RETURNING to_jsonb(tenant_config.*) INTO v_new;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 OR v_new IS NULL THEN
    RAISE EXCEPTION 'conflito_versao: config_loja' USING ERRCODE = 'P0409', DETAIL = array_to_string(v_gravadas, ',');
  END IF;

  -- 8. Retorno: valores pós-gatilhos SÓ das colunas gravadas
  SELECT jsonb_object_agg(k, v_new -> k) INTO v_valores FROM unnest(v_gravadas) AS u(k);
  RETURN jsonb_build_object('gravadas', to_jsonb(v_gravadas), 'valores', coalesce(v_valores, '{}'::jsonb));
END
$function$;

DROP FUNCTION public.ref_previa_revelar(uuid, text);
DROP FUNCTION public._ref_revelar_candidatos(uuid, text);
DROP FUNCTION public._ref_exibir_gate_etapa(uuid, text, text);

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', '39b44a2e9067a4d45f40fb24af1d61fd')) v(s, m) LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l3 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _l3vd_acl_antes WHERE to_regprocedure(assinatura) IS NOT NULL LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l3 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'leves_l3 (volta): ACL de public.salvar_config_loja(uuid,jsonb,jsonb,boolean) fora do esperado (authenticated sim; anon/PUBLIC nao)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.ref_previa_revelar(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'leves_l3 (volta): public.ref_previa_revelar(uuid,text) deveria ter sido removida' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._ref_revelar_candidatos(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'leves_l3 (volta): public._ref_revelar_candidatos(uuid,text) deveria ter sido removida' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._ref_exibir_gate_etapa(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'leves_l3 (volta): public._ref_exibir_gate_etapa(uuid,text,text) deveria ter sido removida' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
