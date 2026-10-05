-- Inverso de supabase/migrations/20261103174000_urg_r2_insumos_padrao.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a2.mjs (nunca editar a mao).
-- Devolve o texto de ANTES de salvar_config_loja (byte a byte o vivo antes da ida, md5 2d43c259135119b345a09a894091c2b5; ACL/DEFINER/VOLATILE/search_path
-- preservados pelo CREATE OR REPLACE): a Config da Loja volta a recusar 'insumos_padrao' (lista branca). A coluna
-- tenant_config.insumos_padrao FICA (inerte; listas gravadas ficam - dado que NAO volta sozinho; o site velho nao a le). DROP de
-- verdade: supabase/rollback/20261103174000_urg_r2_insumos_padrao_down_drop.sql.
-- Volta LIFO: SITE antes (a Config da Loja nova manda a coluna); este arquivo depois do 20261103175000_down (se existir) e ANTES do
-- 20261103173000_down.
-- Trava: SO catalogo (corpo NAO validado - check_function_bodies off: e o texto que ja estava vivo; nenhuma trava de tabela).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';
SET LOCAL check_function_bodies = off;

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)')));
  IF v IS NULL OR v NOT IN ('2d43c259135119b345a09a894091c2b5', '27fdf9f2c9b2d1fe49577e9d30eaa574') THEN
    RAISE EXCEPTION 'urg_r2_174000_down: salvar_config_loja com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'insumos_padrao' AND NOT attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                      WHERE a.attrelid = 'public.tenant_config'::regclass AND a.attname = 'insumos_padrao' AND NOT a.attisdropped
                        AND a.atttypid = 'jsonb'::regtype AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb') THEN
    RAISE EXCEPTION 'urg_r2_174000_down: tenant_config.insumos_padrao existe com outra forma' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

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
  v_reveladas integer := 0;
  v_travadas integer := 0;
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

  -- 2b. leves L3 fix round 1 (M2): a etapa da REF e o Kanban NAO vao no mesmo Salvar - a previa da REF (board gravado) e a do
  -- Kanban (etapa gravada) ficariam com meio estado cada e a revelacao real (irreversivel) nao bateria com nenhuma das duas.
  IF v_m ? 'ref_exibir_status' AND v_m ?| c_kanban THEN
    RAISE EXCEPTION 'ref_etapa_com_kanban: salve a etapa da REF e o kanban em dois passos' USING ERRCODE = 'P0001';
  END IF;

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

  -- 7b. leves L3 kanban #21 (P-211 A): a etapa de revelar a REF veio no Salvar -> revela JA, na MESMA transacao, as REFs
  -- que a etapa gravada libera (a tela mostrou antes a previa "N REFs serao reveladas (nao voltam)" pela RPC so-leitura
  -- ref_previa_revelar, com o MESMO helper). Mesmo caminho de revelar do motor (_kanban_aplicar revela_ref: ref vazia +
  -- ref_auto preenchida -> ref = ref_auto) e mesmo gate do fn_modelo_ref_auto (_kanban_status_gate). Reprovado (Dev OU
  -- Planejamento) NUNCA revela aqui; card travado pela Integracao (ref_sku) fica de fora e e contado (fix round 1, A1/B4).
  IF v_m ? 'ref_exibir_status' THEN
    UPDATE public.modelos m
       SET ref = m.ref_auto
      FROM public._ref_revelar_candidatos(v_tenant, v_new ->> 'ref_exibir_status') c
     WHERE m.id = c.modelo_id
       AND NOT c.travada
       AND m.tenant_id = v_tenant
       AND coalesce(m.ref, '') = ''
       AND coalesce(m.ref_auto, '') <> '';
    GET DIAGNOSTICS v_reveladas = ROW_COUNT;
    SELECT count(*)::integer INTO v_travadas
      FROM public._ref_revelar_candidatos(v_tenant, v_new ->> 'ref_exibir_status') c
     WHERE c.travada;
  END IF;

  -- 8. Retorno: valores pós-gatilhos SÓ das colunas gravadas (+ quantas REFs o 7b revelou / deixou travadas)
  SELECT jsonb_object_agg(k, v_new -> k) INTO v_valores FROM unnest(v_gravadas) AS u(k);
  RETURN jsonb_build_object('gravadas', to_jsonb(v_gravadas), 'valores', coalesce(v_valores, '{}'::jsonb),
                            'refs_reveladas', v_reveladas, 'refs_travadas_integracao', v_travadas);
END
$function$;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) IS DISTINCT FROM '2d43c259135119b345a09a894091c2b5' THEN
    RAISE EXCEPTION 'urg_r2_174000_down: pos-condicao falhou em salvar_config_loja (esperado %)', '2d43c259135119b345a09a894091c2b5' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)') AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres}'
                   AND p.prosecdef AND p.provolatile = 'v' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'urg_r2_174000_down: pos-condicao falhou na ACL/secdef/search_path/volatilidade de salvar_config_loja' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
