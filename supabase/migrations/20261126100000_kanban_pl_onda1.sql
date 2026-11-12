-- Kanban PL configuravel - Onda 1 (SO BANCO + libs puras). Campanha nov/2026.
-- NADA muda na tela: etapas_pl_automatico default false -> nada deriva, nada move. Inerte ate a Onda 3.
-- UMA migration, 3 blocos:
--   A) estado persistido: modelos.status_etapa_pl (NULL = fora do PL) + tabela modelo_etapa_pl_historico
--      (RLS SELECT por tenant; escrita so por RPC/trigger DEFINER - sem policy de INSERT para o cliente).
--   B) 4 configs por loja em tenant_config + salvar_config_loja (lista branca + validacao + UPDATE estatico).
--      As 4 NAO entram em c_kanban (a chave automatico do PL tem porta propria na Onda 2; por ora grava como coluna normal).
--   D) seed idempotente _kanban_pl_seed_etapas(tenant): etapas_pl_kanban vazio recebe os LABELS das etapas
--      atuais da loja (pcp_etapas, preservando renomeacoes) na ordem; ausencia de pcp_etapas => os 5 labels default.
-- Aditiva + idempotente: ADD COLUMN IF NOT EXISTS, CREATE TABLE/INDEX IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS.
-- Aplicar FORA de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza; incidente 15/set).
-- DDL/migration SO na copia local em teste (incidente 23/set). RAISE 5xx so ASCII (P0001 = 400).
-- ============================== ACCEPTED-MD5 (salvar_config_loja, bloco B) ==============================
--   public.salvar_config_loja(uuid,jsonb,jsonb,boolean)
--     ANTES  36e6821ce97b3f2542cd3633c065a7a1   (20261124100000 F6 Fluxo 2: explosao_requisitos)
--     DEPOIS 08382539bfa5f7429ee1fd61f6032d0a
-- =======================================================================================================
-- Volta: supabase/rollback/20261126100000_kanban_pl_onda1_down.sql (neutraliza salvar_config_loja; objetos A/D caem no _down_drop).
--        supabase/rollback/20261126100000_kanban_pl_onda1_down_drop.sql (DROP das 4 colunas + tabela + seed; horario calmo: AccessExclusive em modelos/tenant_config).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

-- ============================== BLOCO A - estado persistido ==============================
ALTER TABLE public.modelos ADD COLUMN IF NOT EXISTS status_etapa_pl text;
COMMENT ON COLUMN public.modelos.status_etapa_pl IS 'Kanban PL (campanha nov/2026): key da etapa PL atual do modelo; NULL = fora do PL. Inerte ate a Onda 3.';

CREATE TABLE IF NOT EXISTS public.modelo_etapa_pl_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  modelo_id uuid NOT NULL REFERENCES public.modelos(id) ON DELETE CASCADE,
  status text NOT NULL,
  entrou_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  origem text NOT NULL DEFAULT 'manual',
  lote_id uuid
);
CREATE INDEX IF NOT EXISTS idx_mepl_modelo ON public.modelo_etapa_pl_historico(modelo_id, entrou_at);
CREATE INDEX IF NOT EXISTS idx_mepl_tenant ON public.modelo_etapa_pl_historico(tenant_id);
ALTER TABLE public.modelo_etapa_pl_historico ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mepl_tenant_select ON public.modelo_etapa_pl_historico;
CREATE POLICY mepl_tenant_select ON public.modelo_etapa_pl_historico FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());
-- Escrita so por trigger/RPC DEFINER (owner postgres bypassa RLS) - sem policy de INSERT/UPDATE/DELETE p/ cliente.

-- ============================== BLOCO B - 4 configs por loja + salvar_config_loja ==============================
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_kanban jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_requisitos jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_automatico boolean NOT NULL DEFAULT false;
ALTER TABLE public.tenant_config ADD COLUMN IF NOT EXISTS etapas_pl_aba_peca_teste_status text;

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
    'tab_labels', 'campos_editaveis', 'insumos_padrao', 'aprovar_custo_auto_por_versao',
    'plan_tecido_oc_bloqueia_lancado', 'explosao_requisitos',
    'etapas_pl_kanban', 'etapas_pl_requisitos', 'etapas_pl_automatico', 'etapas_pl_aba_peca_teste_status'];
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
      WHEN 'aprovar_custo_auto_por_versao' THEN
        -- [R12] modo da aprovacao automatica de custo por versao: texto, um dos 3 valores (a coluna tem CHECK igual)
        IF v_t <> 'string' OR NOT (v_v #>> '{}' = ANY (ARRAY['nenhum', 'interno', 'todos'])) THEN
          RAISE EXCEPTION 'Modo de aprovação automática de custo inválido: %.', coalesce(v_v #>> '{}', 'vazio') USING ERRCODE = 'P0001';
        END IF;
      WHEN 'explosao_envio_status', 'ref_exibir_status', 'keywords' THEN
        IF v_t NOT IN ('string', 'null') THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'markup_analise_faixa', 'plan_tecido_oc_bloqueia_lancado' THEN
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
      WHEN 'explosao_requisitos' THEN
        IF v_t = 'null' THEN
          RAISE EXCEPTION 'O campo "%" não pode ficar vazio.', v_k USING ERRCODE = 'P0001';
        ELSIF v_t <> 'array' THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'etapas_pl_kanban' THEN
        -- Kanban PL (campanha nov/2026): lista das colunas do quadro PL. Obrigatória (nao-vazia) e array.
        IF v_t = 'null' THEN
          RAISE EXCEPTION 'O campo "%" não pode ficar vazio.', v_k USING ERRCODE = 'P0001';
        ELSIF v_t <> 'array' THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'etapas_pl_requisitos' THEN
        -- mapa coluna->condicoes do PL; objeto.
        IF v_t NOT IN ('object') THEN
          RAISE EXCEPTION 'Formato inválido para o campo "%".', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'etapas_pl_automatico' THEN
        -- chave do Kanban PL automatico (default false; inerte ate a Onda 3).
        IF v_t NOT IN ('boolean') THEN
          RAISE EXCEPTION 'O campo "%" precisa ser verdadeiro ou falso.', v_k USING ERRCODE = 'P0001';
        END IF;
      WHEN 'etapas_pl_aba_peca_teste_status' THEN
        -- de qual etapa PL a aba Peca Teste parte; texto nullable.
        IF v_t NOT IN ('string', 'null') THEN
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
        -- maximo 20 itens (= limite do editor de insumos do card); item = objeto {etiqueta_id: uuid de etiquetas DA LOJA, cor_id:
        -- ausente/null/"" ou uuid de cores DA LOJA, consumo: numero JSON de 0 a 9999 com no maximo 4 casas decimais (=
        -- modelo_etiquetas.consumo numeric(10,4))}; sem par (insumo, cor) repetido (comparado ja normalizado). Itens conferidos na
        -- ordem; a 1a falha decide a mensagem (item N, 1-based). Mesma regra do espelho TS (fixture compartilhada
        -- tests/fixtures/insumos-padrao-casos.ts). A forma gravada sai da normalizacao (v_mn), antes da trava da linha.
        IF v_t <> 'array' THEN
          RAISE EXCEPTION 'Lista de insumos padrão inválida: precisa ser uma lista.' USING ERRCODE = 'P0001';
        END IF;
        IF jsonb_array_length(v_v) > 20 THEN
          RAISE EXCEPTION 'Lista de insumos padrão inválida: no máximo 20 insumos (veio %).', jsonb_array_length(v_v) USING ERRCODE = 'P0001';
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
            -- consumo: numero JSON (texto e recusado), 0..9999, no maximo 4 casas decimais
            IF jsonb_typeof(v_ip_it -> 'consumo') IS DISTINCT FROM 'number' THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: consumo precisa ser um número de 0 a 9999.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            IF (v_ip_it ->> 'consumo')::numeric < 0 OR (v_ip_it ->> 'consumo')::numeric > 9999 THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: consumo precisa ser um número de 0 a 9999.', v_ip_i USING ERRCODE = 'P0001';
            END IF;
            IF (v_ip_it ->> 'consumo')::numeric <> round((v_ip_it ->> 'consumo')::numeric, 4) THEN
              RAISE EXCEPTION 'Lista de insumos padrão inválida: item %: consumo com no máximo 4 casas decimais.', v_ip_i USING ERRCODE = 'P0001';
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
    insumos_padrao = CASE WHEN v_m ? 'insumos_padrao' THEN v_mn -> 'insumos_padrao' ELSE insumos_padrao END,
    aprovar_custo_auto_por_versao = CASE WHEN v_m ? 'aprovar_custo_auto_por_versao'
                                         THEN v_m ->> 'aprovar_custo_auto_por_versao'
                                         ELSE aprovar_custo_auto_por_versao END,
    plan_tecido_oc_bloqueia_lancado = CASE WHEN v_m ? 'plan_tecido_oc_bloqueia_lancado'
                                           THEN (v_m ->> 'plan_tecido_oc_bloqueia_lancado')::boolean
                                           ELSE plan_tecido_oc_bloqueia_lancado END,
    explosao_requisitos = CASE WHEN v_m ? 'explosao_requisitos' THEN v_m -> 'explosao_requisitos' ELSE explosao_requisitos END,
    etapas_pl_kanban = CASE WHEN v_m ? 'etapas_pl_kanban' THEN v_m -> 'etapas_pl_kanban' ELSE etapas_pl_kanban END,
    etapas_pl_requisitos = CASE WHEN v_m ? 'etapas_pl_requisitos' THEN v_m -> 'etapas_pl_requisitos' ELSE etapas_pl_requisitos END,
    etapas_pl_automatico = CASE WHEN v_m ? 'etapas_pl_automatico' THEN (v_m ->> 'etapas_pl_automatico')::boolean ELSE etapas_pl_automatico END,
    etapas_pl_aba_peca_teste_status = CASE WHEN v_m ? 'etapas_pl_aba_peca_teste_status' THEN nullif(v_m ->> 'etapas_pl_aba_peca_teste_status','') ELSE etapas_pl_aba_peca_teste_status END
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
$function$

;

-- ============================== BLOCO D - seed das 5 etapas ==============================
-- Seed idempotente: etapas_pl_kanban (vazio) recebe os LABELS das etapas atuais da loja (pcp_etapas,
-- preservando renomeacoes) na ordem; ausencia de pcp_etapas => os 5 labels default.
CREATE OR REPLACE FUNCTION public._kanban_pl_seed_etapas(_tenant uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_labels jsonb;
BEGIN
  IF (SELECT jsonb_array_length(coalesce(etapas_pl_kanban, '[]'::jsonb)) FROM tenant_config WHERE tenant_id = _tenant) > 0 THEN
    RETURN; -- ja preenchido: nao sobrescreve
  END IF;
  -- Semeia SO as etapas ATIVAS da pcp_etapas (ativa IS NOT FALSE: ausente/null conta como ativa, so
  -- `false` explicito exclui) — uma etapa desativada nao vira coluna do quadro PL. coalesce NULL->default:
  -- se a loja desativou TODAS (jsonb_agg vazio = NULL), cai nos 5 labels default (nunca lista vazia).
  SELECT coalesce(
    (SELECT jsonb_agg(e->>'label' ORDER BY ord)
       FROM tenant_config tc, jsonb_array_elements(tc.pcp_etapas) WITH ORDINALITY AS t(e, ord)
      WHERE tc.tenant_id = _tenant AND tc.pcp_etapas IS NOT NULL AND jsonb_typeof(tc.pcp_etapas) = 'array'
        AND (e->>'ativa') IS DISTINCT FROM 'false'),
    '["Peça Teste","Separação de Materiais","Retorno de Grade de Corte","Oficina","Finalização"]'::jsonb
  ) INTO v_labels;
  UPDATE tenant_config SET etapas_pl_kanban = v_labels WHERE tenant_id = _tenant;
END $$;
REVOKE EXECUTE ON FUNCTION public._kanban_pl_seed_etapas(uuid) FROM PUBLIC, anon, authenticated;
-- Roda o seed para TODAS as lojas existentes (idempotente):
DO $$ DECLARE t uuid; BEGIN FOR t IN SELECT tenant_id FROM tenant_config LOOP PERFORM public._kanban_pl_seed_etapas(t); END LOOP; END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
