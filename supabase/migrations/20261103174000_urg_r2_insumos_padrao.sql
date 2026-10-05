-- Urgentes R2 T9 - lista "Insumos padrao" da loja: coluna tenant_config.insumos_padrao + salvar_config_loja (Rulings A12-A13).
-- GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a2.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-a.md (Task 9; R2; P-306 B: a lista vale em TODOS os jeitos de criar card interno).
-- O que muda:
--   1) coluna NOVA public.tenant_config.insumos_padrao jsonb NOT NULL DEFAULT '[]'::jsonb (default constante: so catalogo, sem
--      reescrever a tabela; toda loja nasce com lista vazia). Sem GRANT novo: o authenticated ja le a tabela inteira (RLS da loja);
--      quem grava e SO salvar_config_loja (a tela nunca faz UPDATE direto - mesma regra das outras 17 colunas da Config da Loja).
--   2) salvar_config_loja (1x CREATE OR REPLACE, troca EXATA sobre o vivo, 4 ancoras 1x; ACL/DEFINER/VOLATILE/search_path
--      preservados): 'insumos_padrao' entra na lista branca; validacao (lista; <= 50; item objeto; insumo = uuid de etiquetas DA
--      LOJA; cor ausente/null/"" ou uuid de cores DA LOJA; consumo numero JSON 0..9999; sem par (insumo, cor) repetido) com recusa
--      P0001 "Lista de insumos padrao invalida: <motivo>" (PT com acento, como as vizinhas - 400); normalizacao em v_mn
--      ([{etiqueta_id, cor_id, consumo}] na mesma ordem, uuid minusculo, cor vazia = null) usada no compare-and-set E no UPDATE;
--      compare-and-set por coluna como as outras (P0409 conflito_versao: config_loja, DETAIL insumos_padrao - ASCII).
-- Nenhum dado muda (a coluna nasce '[]' em todas as lojas).
-- Trava: o CREATE OR REPLACE e so catalogo e vem PRIMEIRO; o ADD COLUMN pede AccessExclusiveLock em public.tenant_config, que os
-- portoes de modulo e as policies de ESCRITA leem (tenant_module_enabled): enquanto a txn dura, gravar e carregar a loja esperam
-- (ver MEDIDO abaixo). Por isso: tentativa ATOMICA
-- (LOCK TABLE + ADD COLUMN) com lock_timeout 1500ms, ate 3x com 1s de pausa (padrao S3d); depois, 55P03 aborta e nada muda (rodar o
-- arquivo de novo). Reaplicar com a coluna ja criada NAO pega trava nenhuma em tenant_config. HORARIO CALMO.
-- MEDIDO na copia (05/out, supautils carregado), por diferenca de pg_locks desta txn: AccessExclusiveLock e ShareUpdateExclusiveLock
-- (o COMMENT ON COLUMN) SO em public.tenant_config; NADA em auth/storage/realtime (a validacao do corpo plpgsql nao toca tabela).
-- Corpo inteiro ~8 ms dentro da txn (psql -f do arquivo ~70 ms com a conexao). Fila atras do AccessExclusive (2a conexao,
-- lock_timeout 700ms): ESPERAM a leitura direta de tenant_config (modulos/fuso/Config da Loja: toda tela carrega),
-- tenant_module_enabled (RPCs com portao de modulo e as policies de ESCRITA de ~62 tabelas, ex.: UPDATE modelos) e o SELECT das
-- 6 tabelas com modgate_sel (produtos_acabados/importados e filhas); NAO esperam SELECT de modelos/artigos/users/tenants,
-- minhas_permissoes_efetivas, storage.objects, auth.users/sessions/refresh_tokens (login) e realtime.subscription.
-- Idempotente (a guarda aceita o texto de antes OU o de depois).
-- ATENCAO (LIFO): enquanto esta migration estiver viva RECUSAM pela guarda md5 (fixam 2d43c259135119b345a09a894091c2b5) - desfazer ESTA antes:
--   supabase/rollback/20261027130000_ref_revelar_ao_mudar_etapa_down.sql
--   supabase/migrations/20261027110000_ref_sigla_e_msg_reprovado.sql
--   supabase/migrations/20261027130000_ref_revelar_ao_mudar_etapa.sql
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.salvar_config_loja(uuid,jsonb,jsonb,boolean)
--     ANTES  2d43c259135119b345a09a894091c2b5
--     DEPOIS f43aabf3946e2c142d51b7cba45e04bc
-- ====================================================================================
-- Volta: supabase/rollback/20261103174000_urg_r2_insumos_padrao_down.sql (devolve o texto de ANTES; a coluna FICA - o site velho nao a le) - ANTES do 20261103173000_down.
-- DROP da coluna: supabase/rollback/20261103174000_urg_r2_insumos_padrao_down_drop.sql (opcional, depois, horario calmo).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)')));
  IF v IS NULL OR v NOT IN ('2d43c259135119b345a09a894091c2b5', 'f43aabf3946e2c142d51b7cba45e04bc') THEN
    RAISE EXCEPTION 'urg_r2_174000: salvar_config_loja com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'insumos_padrao' AND NOT attisdropped)
     AND NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                      WHERE a.attrelid = 'public.tenant_config'::regclass AND a.attname = 'insumos_padrao' AND NOT a.attisdropped
                        AND a.atttypid = 'jsonb'::regtype AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb') THEN
    RAISE EXCEPTION 'urg_r2_174000: tenant_config.insumos_padrao existe com outra forma' USING ERRCODE = 'P0001';
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
    'tab_labels', 'campos_editaveis', 'insumos_padrao'];
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
      WHEN 'insumos_padrao' THEN
        -- [urg R2] lista "Insumos padrao" da loja (pre-preenche a secao Insumos do card INTERNO novo): lista obrigatoria, no
        -- maximo 50 itens; item = objeto {etiqueta_id: uuid de etiquetas DA LOJA, cor_id: ausente/null/"" ou uuid de cores DA
        -- LOJA, consumo: numero JSON de 0 a 9999}; sem par (insumo, cor) repetido (comparado ja normalizado). Itens conferidos na
        -- ordem; a 1a falha decide a mensagem (item N, 1-based). Mesma regra do espelho TS (fixture compartilhada
        -- tests/fixtures/insumos-padrao-casos.ts). A forma gravada sai da normalizacao (v_mn), antes da trava da linha.
        IF v_t <> 'array' THEN
          RAISE EXCEPTION 'Lista de insumos padrão inválida: precisa ser uma lista.' USING ERRCODE = 'P0001';
        END IF;
        IF jsonb_array_length(v_v) > 50 THEN
          RAISE EXCEPTION 'Lista de insumos padrão inválida: no máximo 50 insumos (veio %).', jsonb_array_length(v_v) USING ERRCODE = 'P0001';
        END IF;
        DECLARE
          v_ip_it jsonb;
          v_ip_i integer;
          v_ip_e text;
          v_ip_c text;
          v_ip_tc text;
          v_ip_par text[] := ARRAY[]::text[];
          v_ip_rep integer;
        BEGIN
          FOR v_ip_it, v_ip_i IN
            SELECT a.value, a.ord::integer FROM jsonb_array_elements(v_v) WITH ORDINALITY AS a(value, ord) ORDER BY a.ord
          LOOP
            IF jsonb_typeof(v_ip_it) IS DISTINCT FROM 'object' THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: formato inválido.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            -- insumo: texto no formato uuid (sem espacos), da loja
            v_ip_e := CASE WHEN jsonb_typeof(v_ip_it -> 'etiqueta_id') = 'string' THEN v_ip_it ->> 'etiqueta_id' END;
            IF v_ip_e IS NULL OR v_ip_e !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: insumo não encontrado nesta loja.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            v_ip_e := v_ip_e::uuid::text;
            IF NOT EXISTS (SELECT 1 FROM public.etiquetas e WHERE e.id = v_ip_e::uuid AND e.tenant_id = v_tenant) THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: insumo não encontrado nesta loja.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            -- cor: ausente, null ou "" = sem cor; texto nao vazio = uuid de cores da loja; outro tipo = recusa
            v_ip_tc := jsonb_typeof(v_ip_it -> 'cor_id');
            v_ip_c := NULL;
            IF v_ip_tc = 'string' AND (v_ip_it ->> 'cor_id') <> '' THEN
              v_ip_c := v_ip_it ->> 'cor_id';
              IF v_ip_c !~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$' THEN
                RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: cor não encontrada nesta loja.', v_ip_i USING ERRCODE = 'P0001';
              END IF;
              v_ip_c := v_ip_c::uuid::text;
              IF NOT EXISTS (SELECT 1 FROM public.cores co WHERE co.id = v_ip_c::uuid AND co.tenant_id = v_tenant) THEN
                RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: cor não encontrada nesta loja.', v_ip_i USING ERRCODE = 'P0001';
              END IF;
            ELSIF v_ip_tc IS NOT NULL AND v_ip_tc NOT IN ('null', 'string') THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: cor não encontrada nesta loja.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            -- consumo: numero JSON (texto e recusado), 0..9999
            IF jsonb_typeof(v_ip_it -> 'consumo') IS DISTINCT FROM 'number' THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: consumo precisa ser um número de 0 a 9999.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            IF (v_ip_it ->> 'consumo')::numeric < 0 OR (v_ip_it ->> 'consumo')::numeric > 9999 THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: consumo precisa ser um número de 0 a 9999.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            v_ip_rep := array_position(v_ip_par, v_ip_e || '|' || coalesce(v_ip_c, ''));
            IF v_ip_rep IS NOT NULL THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: insumo e cor repetidos (já no item %).', v_ip_i, v_ip_rep USING ERRCODE = 'P0001';
            END IF;
            v_ip_par := v_ip_par || (v_ip_e || '|' || coalesce(v_ip_c, ''));
          END LOOP;
        END;
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

  -- [urg R2] insumos_padrao (ja validada no passo 3): [{etiqueta_id, cor_id, consumo}] na MESMA ordem, so essas 3 chaves; uuid
  -- canonico (minusculo); cor ausente/null/"" -> null; consumo numerico. Forma ESTAVEL: e a que fica gravada e a que os leitores da
  -- lista (criacao do card interno) recebem; o compare-and-set e o UPDATE usam esta.
  IF v_mn ? 'insumos_padrao' THEN
    v_mn := jsonb_set(v_mn, '{insumos_padrao}', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'etiqueta_id', (a.value ->> 'etiqueta_id')::uuid::text,
               'cor_id', CASE WHEN coalesce(a.value ->> 'cor_id', '') = '' THEN NULL ELSE (a.value ->> 'cor_id')::uuid::text END,
               'consumo', (a.value ->> 'consumo')::numeric) ORDER BY a.ord)
        FROM jsonb_array_elements(v_m -> 'insumos_padrao') WITH ORDINALITY AS a(value, ord)), '[]'::jsonb));
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
    campos_editaveis = CASE WHEN v_m ? 'campos_editaveis' THEN v_m -> 'campos_editaveis' ELSE campos_editaveis END,
    insumos_padrao = CASE WHEN v_m ? 'insumos_padrao' THEN v_mn -> 'insumos_padrao' ELSE insumos_padrao END
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

-- ADD COLUMN: uma tentativa ATOMICA por vez (LOCK TABLE + ALTER num sub-bloco). Se a trava nao vier em ate 1500ms (> deadlock_timeout:
-- cancela autovacuum) ou houver deadlock, o sub-bloco falha e LIBERA tudo antes da pausa de 1s. Ate 3 tentativas; depois, 55P03.
DO $col$
DECLARE
  i int;
BEGIN
  -- reaplicar com a coluna ja criada nao pega trava nenhuma (ADD COLUMN IF NOT EXISTS pegaria AccessExclusive mesmo assim)
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.tenant_config'::regclass AND attname = 'insumos_padrao' AND NOT attisdropped) THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.tenant_config IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.tenant_config ADD COLUMN insumos_padrao jsonb NOT NULL DEFAULT '[]'::jsonb;
      COMMENT ON COLUMN public.tenant_config.insumos_padrao IS 'Lista Insumos padrao da loja (urg R2): [{etiqueta_id, cor_id, consumo}] normalizada, gravada SO por salvar_config_loja (compare-and-set por coluna). Pre-preenche a secao Insumos do card INTERNO criado. Sem FK: insumo/cor apagados ficam orfaos e quem le ignora a linha (Ruling A12).';
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$col$;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) IS DISTINCT FROM 'f43aabf3946e2c142d51b7cba45e04bc' THEN
    RAISE EXCEPTION 'urg_r2_174000: pos-condicao falhou em salvar_config_loja (esperado %)', 'f43aabf3946e2c142d51b7cba45e04bc' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)') AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,authenticated=X/postgres}'
                   AND p.prosecdef AND p.provolatile = 'v' AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'urg_r2_174000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de salvar_config_loja' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                  WHERE a.attrelid = 'public.tenant_config'::regclass AND a.attname = 'insumos_padrao' AND NOT a.attisdropped
                    AND a.atttypid = 'jsonb'::regtype AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = '''[]''::jsonb')
     OR NOT has_column_privilege('authenticated', 'public.tenant_config', 'insumos_padrao', 'SELECT')
     OR has_column_privilege('anon', 'public.tenant_config', 'insumos_padrao', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r2_174000: pos-condicao falhou na coluna tenant_config.insumos_padrao' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
