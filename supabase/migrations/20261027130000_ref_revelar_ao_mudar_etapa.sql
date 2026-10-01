-- Achados LEVES, release L3 (Kanban, REF e SKU; banco antes do site) - parte 4: kanban #21 (P-211 A, dono 01/out).
--   Salvar a Config da Loja com a etapa NOVA de revelar a REF (tenant_config.ref_exibir_status) mostra antes a previa
--   "N REFs serao reveladas (nao voltam)" e REVELA NA HORA, na mesma transacao do Salvar (antes so gravava a etapa: as REFs
--   dos cards ja na etapa nova ficavam escondidas ate o card mudar de novo - copia: 0 casos).
--   _ref_exibir_gate_etapa(uuid,text,text)   NOVA, so leitura: ESPELHO de _ref_exibir_gate com a etapa DADA (a candidata), nao
--                                            a gravada. Mesmo corpo linha a linha (anti-drift no teste de integracao).
--   _ref_revelar_candidatos(uuid,text)       NOVA, so leitura: os cards que a etapa revelaria agora - Ordem de Criacao enviada,
--                                            ref vazia, ref_auto preenchida, gate da etapa pela posicao do card
--                                            (_kanban_status_gate: DERIVADA com a chave ligada, como o fn_modelo_ref_auto) e
--                                            NUNCA 'reprovado' (P-190 A; aqui tambem com a chave desligada - revelar e
--                                            irreversivel e esta revelacao em lote nao foi pedida pelo card).
--   ref_previa_revelar(uuid,text)            NOVA RPC so leitura (STABLE; nada grava - "nada grava antes do Salvar"): total + 20
--                                            de amostra para a etapa candidata. So o admin da loja ativa (mesma regra do
--                                            salvar_config_loja).
--   salvar_config_loja                       com 'ref_exibir_status' no Salvar: depois do UPDATE, revela (ref = ref_auto) os
--                                            candidatos da etapa GRAVADA (mesmo helper da previa) e devolve 'refs_reveladas'.
-- REF revelada nao volta (inv. #11) - nem com a volta desta migration.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public.salvar_config_loja(uuid,jsonb,jsonb,boolean)
--     ANTES  691acd27ea96adc5466464320311ef10  -- "depois" da 20261027110000 (esta release)
--     DEPOIS 6c57492d2edaa4a1a64237b83256b15c  (este arquivo; reaplicar = no-op)
--   NOVAS (antes = ausentes):
--     public._ref_exibir_gate_etapa(uuid,text,text)  DEPOIS 99342e2e1ea3c4c43a2d0943b2c0bdc3
--     public._ref_revelar_candidatos(uuid,text)      DEPOIS 98610da4b58ef8a754c823e366f3d116
--     public.ref_previa_revelar(uuid,text)           DEPOIS df61b499940f1bae770ccfd67961d16f
--   Sem mudanca (so guarda):
--     public._ref_exibir_gate(uuid,text)          824e463a9223f3fe4646d771276c856f  INTOCADA  -- CONFIRMADO: Passo 0 dos MEDIOS (01/out 11:06)
--     public._kanban_status_gate(uuid,uuid,text)  635c7bbad3a3db2779f68fd1c5c8a954  INTOCADA  -- md5 "depois" da R14 (20261024100000)
--     public._kanban_norm(text)                   74606b6e06de34fa23fd0642d1ebafbb  INTOCADA  -- PROVISORIO (copia 54422)
--     public.fn_modelo_ref_auto()                 36f303e458a6ed95fd97c6ed2802dc6b  INTOCADA  -- PROVISORIO (copia 54422); visto igual no Passo 0 contas certas (30/set 11:22)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: CREATE OR REPLACE FUNCTION (3 novas + 1 trocada); nada em tabela, nada em auth/storage. Sem DDL de tabela, sem DROP,
-- sem gatilho. ACL: as 2 helpers sem EXECUTE para PUBLIC/anon/authenticated (inv. #9); ref_previa_revelar COM authenticated e
-- SEM PUBLIC/anon; salvar_config_loja com a ACL de antes (identica).
-- Volta: supabase/rollback/20261027130000_ref_revelar_ao_mudar_etapa_down.sql (devolve o salvar_config_loja da 110000 e DROPa
-- as 3 funcoes novas - DROP FUNCTION so pega a trava de objeto da propria funcao). LIFO: e o PRIMEIRO inverso da L3 (antes do
-- 110000_down). SITE PRIMEIRO na volta (o site novo chama ref_previa_revelar; sem ela a previa falha e o Salvar da etapa da
-- REF avisa o erro). REFs reveladas ficam.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l3v_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l3v_md5_aceitos VALUES
  ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', '691acd27ea96adc5466464320311ef10', 'antes'),  -- "depois" da 20261027110000
  ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', '6c57492d2edaa4a1a64237b83256b15c', 'depois'),
  ('public._ref_exibir_gate_etapa(uuid,text,text)', NULL, 'antes'),  -- ausente
  ('public._ref_exibir_gate_etapa(uuid,text,text)', '99342e2e1ea3c4c43a2d0943b2c0bdc3', 'depois'),
  ('public._ref_revelar_candidatos(uuid,text)', NULL, 'antes'),  -- ausente
  ('public._ref_revelar_candidatos(uuid,text)', '98610da4b58ef8a754c823e366f3d116', 'depois'),
  ('public.ref_previa_revelar(uuid,text)', NULL, 'antes'),  -- ausente
  ('public.ref_previa_revelar(uuid,text)', 'df61b499940f1bae770ccfd67961d16f', 'depois'),
  ('public._ref_exibir_gate(uuid,text)', '824e463a9223f3fe4646d771276c856f', 'dep'),
  ('public._kanban_status_gate(uuid,uuid,text)', '635c7bbad3a3db2779f68fd1c5c8a954', 'dep'),
  ('public._kanban_norm(text)', '74606b6e06de34fa23fd0642d1ebafbb', 'dep'),
  ('public.fn_modelo_ref_auto()', '36f303e458a6ed95fd97c6ed2802dc6b', 'dep');

CREATE TEMP TABLE _l3v_acl_antes ON COMMIT DROP AS
  SELECT (SELECT p.proacl::text FROM pg_proc p
           WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)')) AS acl;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3v_md5_aceitos LOOP
    v_md5 := CASE WHEN to_regprocedure(r.assinatura) IS NULL THEN NULL
                  ELSE md5(pg_get_functiondef(to_regprocedure(r.assinatura))) END;
    IF NOT EXISTS (SELECT 1 FROM _l3v_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 IS NOT DISTINCT FROM v_md5) THEN
      RAISE EXCEPTION 'leves_l3: % fora do esperado (md5 %) - falta a 20261027110000 ou outra frente mexeu; conferir o Passo 0',
        r.assinatura, coalesce(v_md5, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._ref_exibir_gate_etapa(_tenant uuid, _status text, _etapa text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg text;
  v_cfg_idx int;
  v_cur_idx int;
  v_status text;
BEGIN
  -- leves L3 kanban #21 (P-211 A): ESPELHO de _ref_exibir_gate com a etapa da REF DADA (a candidata da previa), nao a gravada.
  -- Mesmo corpo linha a linha; anti-drift: tests/integration/ref-revelar-etapa.test.ts compara com _ref_exibir_gate.
  v_cfg := _etapa;
  IF v_cfg IS NULL OR btrim(v_cfg) = '' THEN v_cfg := 'aprovado'; END IF;

  SELECT r.ord INTO v_cfg_idx
    FROM public._kanban_status_rows(_tenant) r WHERE r.key = v_cfg ORDER BY r.ord LIMIT 1;

  -- Órfã: etapa configurada sumiu do board → fallback 'aprovado'.
  IF v_cfg_idx IS NULL AND v_cfg <> 'aprovado' THEN
    v_cfg := 'aprovado';
    SELECT r.ord INTO v_cfg_idx
      FROM public._kanban_status_rows(_tenant) r WHERE r.key = 'aprovado' ORDER BY r.ord LIMIT 1;
  END IF;

  v_status := lower(btrim(coalesce(_status, '')));
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(_tenant) r WHERE r.key = v_status ORDER BY r.ord LIMIT 1;

  IF v_cfg_idx IS NULL THEN
    -- Board sem a etapa configurada E sem 'aprovado' → conservador: só igualdade exata.
    RETURN (v_status = v_cfg);
  ELSIF v_cur_idx IS NULL THEN
    -- Status do modelo fora do board (renomeado) → só igualdade exata.
    RETURN (v_status = v_cfg);
  ELSE
    RETURN (v_cur_idx >= v_cfg_idx);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._ref_revelar_candidatos(_tenant uuid, _etapa text)
 RETURNS TABLE(modelo_id uuid, nome text, ref_auto text, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- leves L3 kanban #21 (P-211 A): os cards cuja REF a etapa _etapa revela AGORA. Fonte UNICA da previa (ref_previa_revelar)
  -- e da revelacao no Salvar (salvar_config_loja 7b). Gate = o do fn_modelo_ref_auto (posicao do card por _kanban_status_gate)
  -- com a etapa DADA; reprovado nunca (P-190 A).
  SELECT m.id, m.nome::text, m.ref_auto, m.status_desenvolvimento::text
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND coalesce(m.ordem_criacao_enviada, false)
     AND coalesce(m.ref, '') = ''
     AND coalesce(m.ref_auto, '') <> ''
     AND public._kanban_norm(m.status_desenvolvimento) <> 'reprovado'
     AND coalesce(public._ref_exibir_gate_etapa(_tenant,
           public._kanban_status_gate(_tenant, m.id, m.status_desenvolvimento), _etapa), false)
   ORDER BY m.nome, m.id;
$function$;

CREATE OR REPLACE FUNCTION public.ref_previa_revelar(_tenant_id uuid, _ref_exibir_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- leves L3 kanban #21 (P-211 A): PREVIA so leitura do Salvar da Config da Loja com a etapa nova da REF - quantos cards (e uma
-- amostra de ate 20) teriam a REF revelada AGORA se a etapa fosse _ref_exibir_status. Nada grava (STABLE). A revelacao de
-- verdade acontece no salvar_config_loja, com o MESMO helper (_ref_revelar_candidatos).
DECLARE
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  c_amostra constant integer := 20;
  v_tenant uuid;
  v_total integer;
  v_amostra jsonb;
BEGIN
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
  SELECT count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object('modelo_id', c.modelo_id, 'nome', c.nome, 'ref_auto', c.ref_auto,
                                               'status', c.status)
                            ORDER BY c.nome, c.modelo_id) FILTER (WHERE c.rn <= c_amostra), '[]'::jsonb)
    INTO v_total, v_amostra
    FROM (SELECT x.*, row_number() OVER (ORDER BY x.nome, x.modelo_id) AS rn
            FROM public._ref_revelar_candidatos(v_tenant, _ref_exibir_status) x) c;
  RETURN jsonb_build_object('etapa', coalesce(nullif(btrim(coalesce(_ref_exibir_status, '')), ''), 'aprovado'),
                            'total', v_total, 'amostra', v_amostra, 'limite_amostra', c_amostra);
END;
$function$;

REVOKE ALL ON FUNCTION public._ref_exibir_gate_etapa(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ref_revelar_candidatos(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ref_previa_revelar(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ref_previa_revelar(uuid, text) TO authenticated;

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
  -- ref_auto preenchida -> ref = ref_auto) e mesmo gate do fn_modelo_ref_auto (_kanban_status_gate: posicao derivada com a
  -- chave ligada). Reprovado NUNCA revela aqui (P-190 A; com a chave desligada tambem - irreversivel, so pela etapa do card).
  IF v_m ? 'ref_exibir_status' THEN
    UPDATE public.modelos m
       SET ref = m.ref_auto
      FROM public._ref_revelar_candidatos(v_tenant, v_new ->> 'ref_exibir_status') c
     WHERE m.id = c.modelo_id
       AND m.tenant_id = v_tenant
       AND coalesce(m.ref, '') = ''
       AND coalesce(m.ref_auto, '') <> '';
    GET DIAGNOSTICS v_reveladas = ROW_COUNT;
  END IF;

  -- 8. Retorno: valores pós-gatilhos SÓ das colunas gravadas (+ quantas REFs o 7b revelou)
  SELECT jsonb_object_agg(k, v_new -> k) INTO v_valores FROM unnest(v_gravadas) AS u(k);
  RETURN jsonb_build_object('gravadas', to_jsonb(v_gravadas), 'valores', coalesce(v_valores, '{}'::jsonb),
                            'refs_reveladas', v_reveladas);
END
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
  v_erros text := '';
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _l3v_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := CASE WHEN to_regprocedure(r.assinatura) IS NULL THEN NULL
                  ELSE md5(pg_get_functiondef(to_regprocedure(r.assinatura))) END;
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      v_erros := v_erros || format(' [%s %s md5 %s]', r.assinatura, r.papel, coalesce(v_md5, 'ausente'));
    END IF;
  END LOOP;
  IF v_erros <> '' THEN
    RAISE EXCEPTION 'leves_l3: pos-condicao falhou - texto inesperado:%', v_erros USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))
     IS DISTINCT FROM (SELECT acl FROM _l3v_acl_antes) THEN
    RAISE EXCEPTION 'leves_l3: pos-condicao falhou - a ACL de salvar_config_loja mudou' USING ERRCODE = 'P0001';
  END IF;
  -- inv. #9: as 2 helpers sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._ref_exibir_gate_etapa(uuid,text,text)'), ('public._ref_revelar_candidatos(uuid,text)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- RPCs publicas (admin da loja): authenticated SIM; anon e PUBLIC NAO.
  FOR r IN SELECT * FROM (VALUES ('public.ref_previa_revelar(uuid,text)'), ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)')) v(s) LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: ACL de % fora do esperado (authenticated sim; anon/PUBLIC nao)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- a previa e so leitura (STABLE) e a helper tambem
  IF (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure('public.ref_previa_revelar(uuid,text)')) <> 's'
     OR (SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure('public._ref_revelar_candidatos(uuid,text)')) <> 's' THEN
    RAISE EXCEPTION 'leves_l3: a previa/helper deixou de ser STABLE (so leitura)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
