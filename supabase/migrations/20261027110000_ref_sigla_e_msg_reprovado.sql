-- Achados LEVES, release L3 (Kanban, REF e SKU; banco antes do site) - parte 2: kanban #18 + R14 msg reprovado (gate 'ref').
--   _ref_sigla_cfg_item   kanban #18: a sigla CONFIGURADA de grupo/categoria/sub1/sub2 (ref_config.sigla_taxonomia) passa a
--                         aceitar SO LETRAS (regex [^A-Za-z]; era [^A-Za-z0-9]). Digito no fim da sigla colava no numero da
--                         REF e o fn_modelo_ref_auto (re-sincronizacao do ref_auto: le o bloco FINAL de digitos como numero)
--                         engolia - a REF mudava de numero. Sigla de familia (_ref_sigla_familia) fica como esta (fora do
--                         achado; ver relatorio). Copia: 0 siglas com digito (plan.md par.4) - nenhuma REF muda.
--   _integracao_gates     R14 msg reprovado: o gate 'ref' fechado por card em 'reprovado' (chave ligada, P-190 A) passa a dizer
--                         "Card reprovado nao revela a REF (nem muda a REF ja gravada)." em vez de "A REF aparece a partir
--                         da etapa X" (falso quando a REF ja aparece). Texto de motivo (jsonb), nao RAISE: PT normal.
--   salvar_config_loja    kanban #18: ref_config com montagem (partes nao nulo) EXIGE a parte "numero" (P0001
--                         'ref_formato_sem_numero: ...') e sigla de taxonomia com digito e recusada (P0001
--                         'ref_sigla_com_digito: <sigla>'). ASCII com prefixo; a tela traduz (src/lib/erro-mensagem.ts) e o
--                         FormatoRefCard ja impede antes. ref_config NULL / sem 'partes' (fallback historico, com numero) passa.
-- Nada gravado muda. Config ja gravada sem "numero" (copia: 0 lojas) so e recusada quando a pessoa salvar o ref_config de novo.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- Nenhuma das 3 foi alterada pelos MEDIOS (R12-R16): "antes" = texto de producao.
--   public._ref_sigla_cfg_item(uuid,uuid)
--     ANTES  0c76738110eb3813669c9cfe01b9a152  -- PROVISORIO (copia 54422); visto igual no Passo 0 contas certas (30/set 11:22) - conferir no Passo 0 dos LEVES
--     DEPOIS 9f4f7b15ca761c3cf655fdc16d67af83  (este arquivo; reaplicar = no-op)
--   public._integracao_gates(uuid)
--     ANTES  0312dd0514f34acc097bc5e053a34e6a  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
--     DEPOIS 366e4f819e24b2e20793c353c4d2fae3  (este arquivo; reaplicar = no-op)
--   public.salvar_config_loja(uuid,jsonb,jsonb,boolean)
--     ANTES  14dd20b65d6e94c71658abdf11c7969b  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
--     DEPOIS 691acd27ea96adc5466464320311ef10  (este arquivo; reaplicar = no-op; a 20261027130000 troca de novo - guarda aceita o "depois" dela)
--     DEPOIS-130000 6c57492d2edaa4a1a64237b83256b15c  (texto da 20261027130000: reaplicar ESTA migration com a 130000 ja aplicada = no-op p/ esta funcao)
--   Sem mudanca (so guarda - o texto novo chama):
--     public._kanban_status_gate(uuid,uuid,text)  635c7bbad3a3db2779f68fd1c5c8a954  INTOCADA  -- md5 "depois" da R14 (20261024100000)
--     public._kanban_norm(text)                   74606b6e06de34fa23fd0642d1ebafbb  INTOCADA  -- PROVISORIO (copia 54422)
--     public._ref_exibir_gate(uuid,text)          824e463a9223f3fe4646d771276c856f  INTOCADA  -- CONFIRMADO: Passo 0 dos MEDIOS (01/out 11:06)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION (nada em tabela, nada em auth/storage). Sem DDL de tabela, sem DROP, sem gatilho, sem
-- funcao nova. ACL: CREATE OR REPLACE mantem a de hoje; pos-condicao: ACL IDENTICA, _ref_sigla_cfg_item/_integracao_gates sem
-- EXECUTE para PUBLIC/anon/authenticated (inv. #9), salvar_config_loja (RPC da Config da Loja) COM authenticated e SEM
-- PUBLIC/anon.
-- Volta: supabase/rollback/20261027110000_ref_sigla_e_msg_reprovado_down.sql. LIFO: roda DEPOIS do inverso da 20261027130000
-- (que devolve o salvar_config_loja deste arquivo) e ANTES dos inversos da R14 e da release 5 (20261015100000_down guarda o
-- salvar_config_loja 14dd20b6). Site: FormatoRefCard (numero obrigatorio, sigla so letras) + erro-mensagem.ts; site velho com
-- banco novo so ve a recusa ASCII crua se mandar config invalida (P0001 passa direto) - aceitavel.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l3r_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l3r_md5_aceitos VALUES
  ('public._ref_sigla_cfg_item(uuid,uuid)', '0c76738110eb3813669c9cfe01b9a152', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._ref_sigla_cfg_item(uuid,uuid)', '9f4f7b15ca761c3cf655fdc16d67af83', 'depois'),
  ('public._integracao_gates(uuid)', '0312dd0514f34acc097bc5e053a34e6a', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._integracao_gates(uuid)', '366e4f819e24b2e20793c353c4d2fae3', 'depois'),
  ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', '14dd20b65d6e94c71658abdf11c7969b', 'antes'),  -- PROVISORIO (copia 54422)
  ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', '691acd27ea96adc5466464320311ef10', 'depois'),
  ('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', '6c57492d2edaa4a1a64237b83256b15c', 'depois_130000'),
  ('public._kanban_status_gate(uuid,uuid,text)', '635c7bbad3a3db2779f68fd1c5c8a954', 'dep'),
  ('public._kanban_norm(text)', '74606b6e06de34fa23fd0642d1ebafbb', 'dep'),
  ('public._ref_exibir_gate(uuid,text)', '824e463a9223f3fe4646d771276c856f', 'dep');

CREATE TEMP TABLE _l3r_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _l3r_md5_aceitos a;

-- Com a 20261027130000 ja aplicada, salvar_config_loja NAO e trocado aqui (reaplicar = no-op; o texto da 130000 contem este).
CREATE TEMP TABLE _l3r_pula_salvar ON COMMIT DROP AS
  SELECT md5(pg_get_functiondef(to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'))) = '6c57492d2edaa4a1a64237b83256b15c' AS pula;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3r_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'leves_l3: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l3r_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'leves_l3: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._ref_sigla_cfg_item(_tenant uuid, _id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  -- leves L3 kanban #18: sigla CONFIGURADA de grupo/categoria/sub = SO LETRAS (digito colado no numero da REF era
  -- engolido pela re-sincronizacao do fn_modelo_ref_auto, que le o bloco final de digitos como o numero).
  SELECT substr(upper(regexp_replace(
    translate(coalesce(public._ref_cfg(_tenant)->'sigla_taxonomia'->>(_id::text),''),
      'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'),
    '[^A-Za-z]','','g')),1,6);
$function$;

CREATE OR REPLACE FUNCTION public._integracao_gates(_modelo_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_int boolean := public._integracao_pode(true);
  v_plan boolean := public.user_can_edit('criacao_planejamento');
  v_dev boolean := public.user_can_edit('criacao_desenvolvimento');
  v_preco boolean;
  v_criacao boolean := public.tenant_module_enabled('criacao');
  v_mod_origem boolean;
  v_kw boolean := public.is_tenant_admin() OR public.is_super_admin();
  v_estado text;
  v_base_motivo text;
  v_base_ok boolean;
  v_enviado boolean;
  v_revelada boolean;
  v_etapa text;
  v_gate_st text;
  v_reprovado boolean;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_preco := v_plan AND public.user_can_edit('criacao_planejamento:preco_venda');
  v_mod_origem := CASE coalesce(m.origem, 'interno')
                    WHEN 'revenda' THEN public.tenant_module_enabled('produto_acabado')
                    WHEN 'importado' THEN public.tenant_module_enabled('produto_importado')
                    ELSE true END;
  SELECT ip.estado INTO v_estado FROM public.integracao_produtos ip WHERE ip.modelo_id = m.id;
  v_estado := coalesce(v_estado, 'nao_integravel');
  v_base_motivo := CASE
    WHEN v_estado <> 'nao_integravel' THEN 'Travado pela integração.'
    WHEN NOT v_int THEN 'Precisa da permissão de editar a Integração.'
    WHEN NOT v_criacao THEN 'O módulo Estilo & Engenharia está desligado nesta loja.'
    WHEN NOT v_mod_origem THEN 'O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.'
  END;
  v_base_ok := v_base_motivo IS NULL;
  -- ruling do controlador, G-migration fix 2 #H3 (A + B-DM-3): sinal ESTRUTURADO e estável (chave ASCII, não
  -- texto em PT) pra quem precisa decidir "é módulo desligado?" sem comparar mensagem — usado por
  -- integracao_marcar (G6) pra reconferir o mesmo predicado de integracao_salvar sem depender do TEXTO do
  -- motivo (que poderia mudar por qualquer edição de UI/copy e destravar tudo em silêncio, B-DM-3).
  v_enviado := coalesce(m.enviado_cad, false);
  v_gate_st := public._kanban_status_gate(m.tenant_id, m.id, m.status_desenvolvimento);
  -- leves L3 (R14 msg reprovado, P-190 A): com a chave ligada, card em 'reprovado' nao tem posicao (gate NULL) - o motivo
  -- do gate 'ref' fechado e o reprovado, nao a etapa (que o card pode ja ter passado).
  v_reprovado := v_gate_st IS NULL AND public._kanban_norm(m.status_desenvolvimento) = 'reprovado';
  v_revelada := coalesce(m.ordem_criacao_enviada, false)
    AND coalesce(public._ref_exibir_gate(m.tenant_id, v_gate_st), false);
  SELECT r.lbl INTO v_etapa
    FROM public._kanban_status_rows(m.tenant_id) r
   WHERE r.key = coalesce(nullif(btrim((SELECT tc.ref_exibir_status FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id)), ''), 'aprovado')
   ORDER BY r.ord
   LIMIT 1;
  RETURN jsonb_build_object(
    'estado', v_estado,
    'origem', coalesce(m.origem, 'interno'),
    -- #H3: chave ASCII estável — true só quando o motivo de base é de MÓDULO (criacao ou origem desligados),
    -- nunca por permissão de seção ou estado travado. Consumidores decidem por isto, não pelo texto do motivo.
    'modulo_bloqueado', v_base_ok = false AND (NOT v_criacao OR NOT v_mod_origem) AND v_estado = 'nao_integravel',
    'compartilhado', public._integracao_gate(v_base_ok, v_base_motivo, v_plan OR (v_dev AND NOT v_enviado),
      'Precisa da permissão de editar o Planejamento (ou o Desenvolvimento antes do envio à Explosão).'),
    'planejamento', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'preco', public._integracao_gate(v_base_ok, v_base_motivo, v_preco, 'Precisa da permissão de preço de venda.'),
    'ref', public._integracao_gate(v_base_ok, v_base_motivo, v_dev AND v_revelada AND NOT v_enviado,
      CASE WHEN NOT v_dev THEN 'Precisa da permissão de editar o Desenvolvimento.'
           WHEN v_reprovado THEN 'Card reprovado não revela a REF (nem muda a REF já gravada).'
           WHEN NOT v_revelada THEN format('A REF aparece a partir da etapa "%s" do kanban.', coalesce(v_etapa, 'Aprovado'))
           ELSE 'REF travada pelo envio à Explosão — não pode mudar depois desse ponto.' END),
    'sku', public._integracao_gate(v_base_ok, v_base_motivo, v_plan, 'Precisa da permissão de editar o Planejamento.'),
    'keywords', public._integracao_gate(v_int, 'Precisa da permissão de editar a Integração.', v_kw,
      'Só o admin da loja muda as Keywords.'));
END
$function$;

DO $salvar$
BEGIN
  IF (SELECT pula FROM _l3r_pula_salvar) THEN
    RETURN;  -- a 20261027130000 ja esta aplicada: salvar_config_loja fica com o texto dela (que contem este)
  END IF;
  EXECUTE $ddl$
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
$ddl$;
END $salvar$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
  v_erros text := '';
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3r_md5_aceitos LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l3r_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5
                      AND a.papel IN ('depois', 'depois_130000', 'dep')) THEN
      v_erros := v_erros || format(' [%s md5 %s]', r.assinatura, v_md5);
    END IF;
  END LOOP;
  IF v_erros <> '' THEN
    RAISE EXCEPTION 'leves_l3: pos-condicao falhou - texto inesperado:%', v_erros USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT assinatura, acl FROM _l3r_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l3: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._ref_sigla_cfg_item(uuid,uuid)'), ('public._integracao_gates(uuid)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- salvar_config_loja: RPC publica (admin da loja) - authenticated SIM; anon e PUBLIC NAO (como hoje).
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.salvar_config_loja(uuid,jsonb,jsonb,boolean)') AND x.grantee = 0
                   AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'leves_l3: ACL de salvar_config_loja fora do esperado (authenticated sim; anon/PUBLIC nao)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
