-- Achados LEVES, release L3 (Kanban, REF e SKU; banco antes do site) - parte 3: sku #5.
--   O mesmo SKU so pode estar em 2 cards quando um e REPLICA do outro: mesma REF (normalizada), mesma cor/tamanho E (novo)
--   mesma FAMILIA de versoes, coalesce(modelo_base_id, id). Antes bastava a REF igual - um produto de OUTRA familia com a
--   mesma REF digitada a mao herdava os SKUs em silencio (copia: 0 colisoes).
--   fn_modelo_skus_unico      gatilho BEFORE INSERT/UPDATE de modelo_skus: a excecao de replica exige a mesma familia.
--   _skus_plano               plano da previa/gravacao (Regerar/Salvar): manual (passo 1) e automatico (passo 3) - mesma regra,
--                             entao o conflito aparece na PREVIA com a mensagem de sempre ("SKU X ja existe em <produto>").
--   _salvar_sku_manual_core   ramo de unique_violation (so monta a mensagem): mesma regra - sem ela, o 23505 do gatilho
--                             caia em "conflito_versao: a linha do SKU foi gravada por outra pessoa" (P0409 falso).
--   _skus_matriz_ref_tipo     a matriz da secao Codigos (estado 'conflito' + conflito_com): mesma regra - sem ela a tela
--                             mostrava "ok" num SKU que o gatilho recusa.
--                             As 2 ultimas estao fora da lista do plan.md (sku #5 cita as 2 de cima) - mesma regra; ver relatorio.
-- PRE-CONDICAO: SKUs iguais entre familias DIFERENTES = 0 (senao a regra nova tornaria invalido algo ja gravado) -> aborta.
-- Nada gravado muda.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- Nenhuma das 3 foi alterada pelos MEDIOS (R12-R16): "antes" = texto de producao.
--   public.fn_modelo_skus_unico()
--     ANTES  4350d324f468b0a1519032c3158eb4c9  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
--     DEPOIS 98fcc32a2ad577cee284f914cac9d588  (este arquivo; reaplicar = no-op)
--   public._skus_plano(uuid,text,text,jsonb,text)
--     ANTES  4c19c6a43934131a875dcd5509c1b800  -- PROVISORIO (copia 54422) = "depois" da ida da release 4 (20261013100000, producao 29/set): conferir no Passo 0 dos LEVES
--     DEPOIS 5980345a105818b26329c8a4e594fee2  (este arquivo; reaplicar = no-op)
--   public._salvar_sku_manual_core(uuid,text,integer,uuid,uuid,text)
--     ANTES  3b2e4c34388dc9d5d53f16b5acf45bd9  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES (fora da lista do par.4)
--     DEPOIS 4a047b0e3d594b13650e67e682287df7  (este arquivo; reaplicar = no-op)
--   public._skus_matriz_ref_tipo(uuid,text,text)
--     ANTES  953095062549ff98dcc83e9572f75a1f  -- PROVISORIO (copia 54422) = "depois" da ida da release 4 (20261013100000, producao 29/set): conferir no Passo 0 dos LEVES (fora da lista do par.4)
--     DEPOIS 0a3279115f0666a79b5bca35792c2865  (este arquivo; reaplicar = no-op)
--   Sem mudanca (so guarda): public._sku_norm_ref(text) 05be04989860dc7a7c6666de2585f9cf INTOCADA -- PROVISORIO (copia 54422)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: so CREATE OR REPLACE FUNCTION + 1 SELECT de contagem (sem trava de tabela alem de AccessShare). Sem DDL de tabela,
-- sem DROP, sem gatilho novo. ACL: CREATE OR REPLACE mantem a de hoje; pos-condicao: ACL IDENTICA e as 4 sem EXECUTE para
-- PUBLIC/anon/authenticated (inv. #9; fn_modelo_skus_unico e funcao de gatilho).
-- Volta: supabase/rollback/20261027120000_sku_replica_familia_down.sql. LIFO: ANTES dos inversos da R14 e, em especial, do
-- 20261013100000_integracao_nome_sublinha_cor_down.sql (release 4), que GUARDA _skus_plano 4c19c6a4 e _skus_matriz_ref_tipo
-- 95309506 (os textos que esta volta devolve) - com a L3 no banco ele recusa. Site: nada (a mensagem de conflito e a de sempre).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l3s_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l3s_md5_aceitos VALUES
  ('public.fn_modelo_skus_unico()', '4350d324f468b0a1519032c3158eb4c9', 'antes'),  -- PROVISORIO (copia 54422)
  ('public.fn_modelo_skus_unico()', '98fcc32a2ad577cee284f914cac9d588', 'depois'),
  ('public._skus_plano(uuid,text,text,jsonb,text)', '4c19c6a43934131a875dcd5509c1b800', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._skus_plano(uuid,text,text,jsonb,text)', '5980345a105818b26329c8a4e594fee2', 'depois'),
  ('public._salvar_sku_manual_core(uuid,text,integer,uuid,uuid,text)', '3b2e4c34388dc9d5d53f16b5acf45bd9', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._salvar_sku_manual_core(uuid,text,integer,uuid,uuid,text)', '4a047b0e3d594b13650e67e682287df7', 'depois'),
  ('public._skus_matriz_ref_tipo(uuid,text,text)', '953095062549ff98dcc83e9572f75a1f', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._skus_matriz_ref_tipo(uuid,text,text)', '0a3279115f0666a79b5bca35792c2865', 'depois'),
  ('public._sku_norm_ref(text)', '05be04989860dc7a7c6666de2585f9cf', 'dep');  -- PROVISORIO (copia 54422)

CREATE TEMP TABLE _l3s_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _l3s_md5_aceitos a;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_n bigint;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3s_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'leves_l3: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l3s_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'leves_l3: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- PRE-CONDICAO (sku #5): nenhum SKU gravado repetido entre familias diferentes da mesma loja.
  SELECT count(*) INTO v_n
    FROM public.modelo_skus a
    JOIN public.modelos ma ON ma.id = a.modelo_id
    JOIN public.modelo_skus b ON b.tenant_id = a.tenant_id AND b.sku = a.sku AND b.id <> a.id
    JOIN public.modelos mb ON mb.id = b.modelo_id
   WHERE coalesce(ma.modelo_base_id, ma.id) <> coalesce(mb.modelo_base_id, mb.id);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'leves_l3: pre-condicao falhou - % par(es) de SKU igual entre familias diferentes; resolver antes (Passo 0)', v_n
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_modelo_skus_unico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text;
  v_familia uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_unico:' || NEW.tenant_id::text, 0));
  -- leves L3 sku #5: replica (mesmo SKU, mesma REF, mesma cor/tamanho) so vale DENTRO da mesma familia de versoes
  -- (coalesce(modelo_base_id, id)); produto de OUTRA familia com a mesma REF digitada = conflito.
  SELECT public._sku_norm_ref(m.ref), coalesce(m.modelo_base_id, m.id) INTO v_ref, v_familia
    FROM public.modelos m WHERE m.id = NEW.modelo_id;
  PERFORM 1
     FROM public.modelo_skus o
     JOIN public.modelos mo ON mo.id = o.modelo_id
    WHERE o.tenant_id = NEW.tenant_id
      AND o.sku = NEW.sku
      AND o.id <> NEW.id
      AND NOT (coalesce(v_ref, '') <> '' AND o.modelo_id <> NEW.modelo_id
               AND public._sku_norm_ref(mo.ref) = v_ref
               AND coalesce(mo.modelo_base_id, mo.id) = v_familia
               AND o.variante_key = NEW.variante_key AND o.tamanho_key = NEW.tamanho_key);
  IF FOUND THEN
    RAISE EXCEPTION 'O SKU % já está em uso na loja.', NEW.sku USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_plano(_modelo_id uuid, _ref text, _tipo text, _manuais jsonb, _modo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.1.2) — o PLANO da gravação dos SKUs de UM card. PURO (STABLE: o
-- PL/pgSQL recusa INSERT/UPDATE/DELETE aqui). Fonte ÚNICA da decisão: a prévia (skus_previa) roda este plano com a REF e o
-- "Tamanho em" do RASCUNHO; a gravação (aplicar_skus_modelo e gerar_skus_modelo) roda o MESMO plano com os valores
-- SALVOS, lidos sob a trava do card, e executa as ops (_skus_executar_plano). Reproduz o laço da F3.5a/F3.6:
--  1. SKUs à mão (_manuais) primeiro, na ordem das chaves, com as regras/mensagens de _salvar_sku_manual_core;
--  2. 'regerar': as automáticas fora da grade saem ANTES (manual nunca);
--  3. 'criar'/'regerar' (só com Formato, REF e "Tamanho em"): cada linha da grade na ordem (variante, tamanho) — manual
--     nunca muda; sem SKU (falta/vazio) fica; 'criar' só cria o que falta; 'regerar' recalcula as automáticas; SKU de
--     OUTRA linha deste card (estado EM EVOLUÇÃO) ou de outro card que não é réplica (REF viva igual + mesma cor/tamanho —
--     D5; leves L3 sku #5: E da mesma família de versões, coalesce(modelo_base_id, id)) = conflito, com as mensagens da F3.5a.
-- chave = variante_key || '|' || tamanho_key.
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_meu_nome text;
  v_meu_ref text;
  v_familia uuid;
  v_gera boolean;
  v_estado jsonb := '{}'::jsonb;
  v_calc jsonb := '{}'::jsonb;
  v_ops jsonb := '[]'::jsonb;
  v_linhas jsonb := '{}'::jsonb;
  v_erros jsonb := '[]'::jsonb;
  v_conflitos jsonb := '[]'::jsonb;
  v_final jsonb;
  r record;
  v_e jsonb;
  v_k text;
  v_vkey text;
  v_tkey text;
  v_atual jsonb;
  v_sku text;
  v_dono text;
  v_msg text;
  v_code text;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
  n_criados integer := 0;
  n_atualizados integer := 0;
  n_removidos integer := 0;
  n_manuais integer := 0;
BEGIN
  IF _modo IS NULL OR _modo NOT IN ('manuais', 'criar', 'regerar') THEN
    RAISE EXCEPTION 'Modo da prévia dos SKUs inválido.' USING ERRCODE = 'P0001';
  END IF;
  IF _manuais IS NULL OR jsonb_typeof(_manuais) <> 'array' THEN
    RAISE EXCEPTION 'SKUs à mão inválidos.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_manuais) AS x(value)
              WHERE jsonb_typeof(x.value) <> 'object'
                 OR jsonb_typeof(x.value -> 'variante_key') IS DISTINCT FROM 'string'
                 OR lower(x.value ->> 'variante_key') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 OR jsonb_typeof(x.value -> 'tamanho_key') IS DISTINCT FROM 'string'
                 OR jsonb_typeof(x.value -> 'sku') IS DISTINCT FROM 'string'
                 OR coalesce(jsonb_typeof(x.value -> 'rev'), 'null') NOT IN ('number', 'null')
                 OR (jsonb_typeof(x.value -> 'rev') = 'number' AND (x.value ->> 'rev') !~ '^[0-9]{1,9}$'))
     OR (SELECT count(*) FROM jsonb_array_elements(_manuais)) <>
        (SELECT count(DISTINCT lower(x.value ->> 'variante_key') || '|' || (x.value ->> 'tamanho_key'))
           FROM jsonb_array_elements(_manuais) AS x(value)) THEN
    RAISE EXCEPTION 'SKUs à mão inválidos.' USING ERRCODE = 'P0001';
  END IF;
  SELECT mo.tenant_id, public._sku_norm_ref(_ref), CASE WHEN tc.sku_config -> 'partes' = '[]'::jsonb THEN NULL ELSE tc.sku_config END, mo.nome, mo.ref,
         coalesce(mo.modelo_base_id, mo.id)
    INTO v_tenant, v_refn, v_cfg, v_meu_nome, v_meu_ref, v_familia
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_gera := _modo <> 'manuais' AND v_cfg IS NOT NULL AND coalesce(v_refn, '') <> '' AND _tipo IS NOT NULL;

  -- estado inicial = o GRAVADO; e o cálculo da grade com a REF/"Tamanho em" DADOS
  FOR r IN SELECT s.id, s.variante_key, s.tamanho_key, s.sku, s.manual, s.rev
             FROM public.modelo_skus s
            WHERE s.modelo_id = _modelo_id LOOP
    v_estado := v_estado || jsonb_build_object(r.variante_key::text || '|' || r.tamanho_key, jsonb_build_object(
                  'id', r.id, 'vkey', r.variante_key::text, 'tkey', r.tamanho_key, 'sku', r.sku, 'manual', r.manual, 'rev', r.rev));
  END LOOP;
  FOR r IN SELECT c.variante_key, c.tamanho_key, c.sku
             FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo) AS c LOOP
    v_calc := v_calc || jsonb_build_object(r.variante_key::text || '|' || r.tamanho_key, to_jsonb(r.sku));
  END LOOP;

  -- 1. SKUs à mão (do rascunho), na ordem das chaves
  FOR v_e IN SELECT x.value FROM jsonb_array_elements(_manuais) AS x(value)
              ORDER BY lower(x.value ->> 'variante_key') COLLATE "C", (x.value ->> 'tamanho_key') COLLATE "C" LOOP
    v_vkey := lower(v_e ->> 'variante_key');
    v_tkey := v_e ->> 'tamanho_key';
    v_k := v_vkey || '|' || v_tkey;
    v_atual := v_estado -> v_k;
    v_msg := NULL;
    v_code := 'P0001';
    v_sku := NULL;
    BEGIN
      v_sku := public._sku_norm_manual(v_e ->> 'sku');
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      v_msg := SQLERRM;
    END;
    IF v_msg IS NULL AND v_atual IS NULL AND NOT (v_calc ? v_k) THEN
      v_msg := 'Esta variante/tamanho não está na grade do produto.';
    END IF;
    -- N2 do G-plano: "já é este SKU, à mão" ANTES do rev — um "a gravar" que sobrou de um Salvar em voo (rev velho) e já
    -- está gravado igual não é conflito: nada muda, nenhuma escrita (sem lost update possível).
    IF v_msg IS NULL AND v_atual IS NOT NULL AND (v_atual ->> 'manual')::boolean AND v_atual ->> 'sku' = v_sku THEN
      CONTINUE;  -- já é este SKU, à mão: nada muda
    END IF;
    -- B1 do G-migration (rodada 1): a linha JÁ tem registro gravado (v_atual não nulo) mas o "a gravar" veio SEM rev
    -- (rev null — a linha estava sem SKU quando o usuário começou a editar): sem isto, outra pessoa podia gravar a MESMA
    -- chave no meio e o Salvar sobrescrevia em silêncio (a assinatura só olha o estado final). Mesma mensagem/ERRCODE do
    -- ramo de corrida do INSERT em _salvar_sku_manual_core.
    IF v_msg IS NULL AND v_atual IS NOT NULL AND jsonb_typeof(v_e -> 'rev') IS DISTINCT FROM 'number' THEN
      v_msg := 'conflito_versao: a linha do SKU foi gravada por outra pessoa';
      v_code := 'P0409';
    END IF;
    IF v_msg IS NULL AND v_atual IS NOT NULL AND jsonb_typeof(v_e -> 'rev') = 'number'
       AND (v_atual ->> 'rev')::integer IS DISTINCT FROM (v_e ->> 'rev')::integer THEN
      v_msg := 'conflito_versao: o SKU foi alterado por outra pessoa';
      v_code := 'P0409';
    END IF;
    IF v_msg IS NULL THEN
      v_dono := NULL;
      SELECT x.key INTO v_dono
        FROM jsonb_each(v_estado) AS x(key, value)
       WHERE x.value ->> 'sku' = v_sku AND x.key <> v_k
       ORDER BY x.key COLLATE "C"
       LIMIT 1;
      IF v_dono IS NOT NULL THEN
        v_msg := format('O SKU %s já está em outra linha deste produto.', v_sku);
      END IF;
    END IF;
    IF v_msg IS NULL THEN
      v_com_modelo := NULL;
      SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
        FROM public.modelo_skus o
        JOIN public.modelos mo ON mo.id = o.modelo_id
       WHERE o.tenant_id = v_tenant AND o.sku = v_sku AND o.modelo_id <> _modelo_id
         AND NOT (coalesce(v_refn, '') <> '' AND public._sku_norm_ref(mo.ref) = v_refn
                  AND coalesce(mo.modelo_base_id, mo.id) = v_familia  -- leves L3 sku #5: replica so na mesma familia
                  AND o.variante_key::text = v_vkey AND o.tamanho_key = v_tkey)
       ORDER BY o.modelo_id
       LIMIT 1;
      IF v_com_modelo IS NOT NULL THEN
        v_msg := format('O SKU %s já existe em %s (REF %s). Escolha outro.', v_sku, coalesce(v_com_nome, 'outro produto'),
                        coalesce(nullif(btrim(v_com_ref), ''), '—'));
      END IF;
    END IF;
    IF v_msg IS NOT NULL THEN
      v_erros := v_erros || jsonb_build_array(jsonb_build_object('variante_key', v_vkey, 'tamanho_key', v_tkey,
                   'code', v_code, 'mensagem', v_msg, 'sku_atual', v_atual -> 'sku', 'rev_atual', v_atual -> 'rev'));
      v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'erro', 'code', v_code, 'mensagem', v_msg,
                   'sku_de', v_atual -> 'sku', 'sku_para', to_jsonb(v_e ->> 'sku')));
      CONTINUE;
    END IF;
    v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'manual', 'id', v_atual -> 'id', 'vkey', v_vkey,
               'tkey', v_tkey, 'sku', v_sku, 'rev_base', v_e -> 'rev'));
    v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'manual_novo', 'sku_de', v_atual -> 'sku',
                 'sku_para', v_sku));
    v_estado := v_estado || jsonb_build_object(v_k, jsonb_build_object('id', v_atual -> 'id', 'vkey', v_vkey, 'tkey', v_tkey,
                 'sku', v_sku, 'manual', true, 'rev', v_atual -> 'rev'));
    n_manuais := n_manuais + 1;
  END LOOP;

  -- 2. 'regerar': as automáticas que saíram da grade saem ANTES de gerar (manual nunca)
  IF v_gera AND _modo = 'regerar' THEN
    FOR v_k, v_atual IN SELECT x.key, x.value FROM jsonb_each(v_estado) AS x(key, value) ORDER BY x.key COLLATE "C" LOOP
      CONTINUE WHEN v_linhas -> v_k ->> 'acao' = 'erro';  -- A#1 do G-migration: não sobrescreve o 'erro' do passo 1 (a linha da tela mostraria "sai" e o erro só ficaria em erros[])
      CONTINUE WHEN (v_atual ->> 'manual')::boolean OR v_calc ? v_k;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'remover', 'id', v_atual -> 'id', 'vkey', v_atual -> 'vkey',
                 'tkey', v_atual -> 'tkey', 'sku', v_atual -> 'sku'));
      v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'sai', 'sku_de', v_atual -> 'sku'));
      v_estado := v_estado - v_k;
      n_removidos := n_removidos + 1;
    END LOOP;
  END IF;

  -- 3. 'criar'/'regerar': cada linha da grade, na ordem do laço da F3.5a
  IF v_gera THEN
    FOR r IN SELECT c.variante_key, c.tamanho_key, c.sku
               FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo) AS c
              ORDER BY c.variante_ordem, c.tamanho_ordem, c.tamanho_key, c.variante_key LOOP
      v_k := r.variante_key::text || '|' || r.tamanho_key;
      CONTINUE WHEN v_linhas -> v_k ->> 'acao' = 'erro';  -- A#1 do G-migration: não sobrescreve o 'erro' do passo 1 (idem passo 2)
      v_atual := v_estado -> v_k;
      CONTINUE WHEN v_atual IS NOT NULL AND (v_atual ->> 'manual')::boolean;                 -- editado à mão: nunca (Q2)
      CONTINUE WHEN r.sku IS NULL;                                                             -- falta sigla (Q4) / vazio
      CONTINUE WHEN v_atual IS NOT NULL AND (_modo <> 'regerar' OR v_atual ->> 'sku' = r.sku); -- fixo (Q2) ou já igual
      v_msg := NULL;
      v_dono := NULL;
      SELECT x.key INTO v_dono
        FROM jsonb_each(v_estado) AS x(key, value)
       WHERE x.value ->> 'sku' = r.sku AND x.key <> v_k
       ORDER BY x.key COLLATE "C"
       LIMIT 1;
      IF v_dono IS NOT NULL THEN
        v_com_modelo := _modelo_id;
        v_com_nome := v_meu_nome;
        v_com_ref := v_meu_ref;
        v_msg := CASE
          WHEN (v_calc ->> v_dono) IS NOT NULL AND (v_calc ->> v_dono) IS DISTINCT FROM (v_estado -> v_dono ->> 'sku') THEN
            format('SKU %s não gravado: esta linha colide com outra deste produto que também muda de SKU neste Regerar. Ajuste um SKU à mão e rode o Regerar de novo.', r.sku)
          ELSE
            format('SKU %s repetido neste produto: duas linhas dão o mesmo SKU. Mude uma sigla ou edite um deles à mão.', r.sku)
        END;
      ELSE
        v_com_modelo := NULL;
        SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
          FROM public.modelo_skus o
          JOIN public.modelos mo ON mo.id = o.modelo_id
         WHERE o.tenant_id = v_tenant AND o.sku = r.sku AND o.modelo_id <> _modelo_id
           AND NOT (public._sku_norm_ref(mo.ref) = v_refn AND coalesce(mo.modelo_base_id, mo.id) = v_familia  -- leves L3 sku #5
                    AND o.variante_key = r.variante_key AND o.tamanho_key = r.tamanho_key)
         ORDER BY o.modelo_id
         LIMIT 1;
        IF v_com_modelo IS NOT NULL THEN
          v_msg := format('SKU %s já existe em %s (REF %s). Edite este SKU à mão ou mude a sigla.', r.sku,
                          coalesce(v_com_nome, 'outro produto'), coalesce(nullif(btrim(v_com_ref), ''), '—'));
        END IF;
      END IF;
      IF v_msg IS NOT NULL THEN
        v_conflitos := v_conflitos || jsonb_build_array(jsonb_build_object(
          'variante_key', r.variante_key, 'tamanho_key', r.tamanho_key, 'sku', r.sku,
          'com_modelo_id', v_com_modelo, 'com_nome', v_com_nome, 'com_ref', v_com_ref, 'mensagem', v_msg));
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'conflito', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku, 'mensagem', v_msg));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'conflito', 'sku_de', v_atual -> 'sku',
                     'sku_para', r.sku, 'mensagem', v_msg));
        CONTINUE;
      END IF;
      IF v_atual IS NULL THEN
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'inserir', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'novo', 'sku_para', r.sku));
        n_criados := n_criados + 1;
      ELSE
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'atualizar', 'id', v_atual -> 'id',
                   'vkey', r.variante_key::text, 'tkey', r.tamanho_key, 'sku', r.sku));
        v_linhas := v_linhas || jsonb_build_object(v_k, jsonb_build_object('acao', 'muda', 'sku_de', v_atual -> 'sku',
                     'sku_para', r.sku));
        n_atualizados := n_atualizados + 1;
      END IF;
      v_estado := v_estado || jsonb_build_object(v_k, jsonb_build_object('id', v_atual -> 'id', 'vkey', r.variante_key::text,
                   'tkey', r.tamanho_key, 'sku', r.sku, 'manual', false, 'rev', v_atual -> 'rev'));
    END LOOP;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_array(x.value ->> 'vkey', x.value ->> 'tkey', x.value ->> 'sku',
                                              (x.value ->> 'manual')::boolean)), '[]'::jsonb)
    INTO v_final
    FROM jsonb_each(v_estado) AS x(key, value);
  RETURN jsonb_build_object(
    'status', CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN coalesce(v_refn, '') = '' THEN 'aguardando_ref'
                   WHEN _tipo IS NULL THEN 'sem_tamanho' ELSE 'ok' END,
    'modo', _modo, 'ops', v_ops, 'linhas', v_linhas, 'erros', v_erros, 'conflitos', v_conflitos,
    'final', v_final, 'assinatura', public._skus_assinatura(v_final),
    'criados', n_criados, 'atualizados', n_atualizados, 'removidos', n_removidos, 'manuais', n_manuais);
END
$function$;

CREATE OR REPLACE FUNCTION public._salvar_sku_manual_core(_id uuid, _sku text, _rev_base integer, _modelo_id uuid, _variante_key uuid, _tamanho_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sku text;
  v_id uuid := _id;
  v_tenant uuid;
  v_modelo uuid;
  v_vkey uuid;
  v_tkey text;
  v_refn text;
  v_familia uuid;
  v_rev integer;
  v_com_modelo uuid;
  v_com_nome text;
  v_com_ref text;
BEGIN
  v_sku := public._sku_norm_manual(_sku);
  IF v_id IS NULL THEN
    IF _modelo_id IS NULL OR _variante_key IS NULL OR coalesce(btrim(_tamanho_key), '') = '' THEN
      RAISE EXCEPTION 'Informe a linha do SKU (modelo, variante e tamanho).' USING ERRCODE = 'P0001';
    END IF;
    v_modelo := _modelo_id;
  ELSE
    SELECT s.modelo_id INTO v_modelo FROM public.modelo_skus s WHERE s.id = v_id;
    IF v_modelo IS NULL THEN
      RAISE EXCEPTION 'SKU não encontrado.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || v_modelo::text, 0));
  IF v_id IS NULL THEN
    SELECT s.id INTO v_id
      FROM public.modelo_skus s
     WHERE s.modelo_id = _modelo_id AND s.variante_key = _variante_key AND s.tamanho_key = _tamanho_key;
    IF v_id IS NULL AND NOT EXISTS (
         SELECT 1 FROM public._skus_modelo_calc(_modelo_id) AS c
          WHERE c.variante_key = _variante_key AND c.tamanho_key = _tamanho_key) THEN
      RAISE EXCEPTION 'Esta variante/tamanho não está na grade do produto.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT s.tenant_id, s.rev, s.variante_key, s.tamanho_key INTO v_tenant, v_rev, v_vkey, v_tkey
      FROM public.modelo_skus s
     WHERE s.id = v_id
       FOR UPDATE;
    IF v_tenant IS NULL THEN
      RAISE EXCEPTION 'SKU não encontrado.' USING ERRCODE = 'P0001';
    END IF;
    IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o SKU foi alterado por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
  ELSE
    SELECT mo.tenant_id INTO v_tenant FROM public.modelos mo WHERE mo.id = v_modelo;
    v_vkey := _variante_key;
    v_tkey := _tamanho_key;
  END IF;
  SELECT public._sku_norm_ref(mo.ref), coalesce(mo.modelo_base_id, mo.id) INTO v_refn, v_familia
    FROM public.modelos mo WHERE mo.id = v_modelo;
  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual, gerado_em)
      VALUES (v_tenant, v_modelo, v_vkey, v_tkey, v_sku, true, now())
      RETURNING id, rev INTO v_id, v_rev;
    ELSE
      UPDATE public.modelo_skus s
         SET sku = v_sku, manual = true, gerado_em = now(), rev = s.rev + 1
       WHERE s.id = v_id
      RETURNING s.rev INTO v_rev;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    SELECT o.modelo_id, mo.nome, mo.ref INTO v_com_modelo, v_com_nome, v_com_ref
      FROM public.modelo_skus o
      JOIN public.modelos mo ON mo.id = o.modelo_id
     WHERE o.tenant_id = v_tenant AND o.sku = v_sku AND o.id IS DISTINCT FROM v_id
       AND NOT (coalesce(v_refn, '') <> '' AND o.modelo_id <> v_modelo AND public._sku_norm_ref(mo.ref) = v_refn
                AND coalesce(mo.modelo_base_id, mo.id) = v_familia  -- leves L3 sku #5: replica so na mesma familia
                AND o.variante_key = v_vkey AND o.tamanho_key = v_tkey)
     ORDER BY (o.modelo_id = v_modelo) DESC, o.modelo_id
     LIMIT 1;
    IF v_com_modelo IS NULL THEN
      RAISE EXCEPTION 'conflito_versao: a linha do SKU foi gravada por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
    IF v_com_modelo = v_modelo THEN
      RAISE EXCEPTION 'O SKU % já está em outra linha deste produto.', v_sku USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'O SKU % já existe em % (REF %). Escolha outro.', v_sku, coalesce(v_com_nome, 'outro produto'),
      coalesce(nullif(btrim(v_com_ref), ''), '—') USING ERRCODE = 'P0001';
  END;
  RETURN jsonb_build_object('id', v_id, 'sku', v_sku, 'manual', true, 'rev', v_rev);
END
$function$;

CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_refn text;
  v_familia uuid;
  v_cfg jsonb;
  v_tipo_card text;
  v_tipo text;
  v_status text;
  v_linhas jsonb;
  v_faltas jsonb;
  v_avisos jsonb;
BEGIN
  SELECT mo.tenant_id, public._sku_norm_ref(_ref), CASE WHEN tc.sku_config -> 'partes' = '[]'::jsonb THEN NULL ELSE tc.sku_config END, _tipo,  -- SKU em prévia: REF e "Tamanho em" por parâmetro
         coalesce(mo.modelo_base_id, mo.id)  -- leves L3 sku #5: réplica só na mesma família
    INTO v_tenant, v_refn, v_cfg, v_tipo_card, v_familia
    FROM public.modelos mo
    LEFT JOIN public.tenant_config tc ON tc.tenant_id = mo.tenant_id
   WHERE mo.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0001';
  END IF;
  v_tipo := v_tipo_card;  -- F3.6 (dono 25/set): sem padrão da loja — NULL = o card ainda não escolheu
  v_status := CASE WHEN v_cfg IS NULL THEN 'sem_formato' WHEN v_refn = '' THEN 'aguardando_ref'
                   WHEN v_tipo IS NULL THEN 'sem_tamanho' ELSE 'ok' END;

  IF v_status <> 'ok' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'sku', s.sku,
             'manual', s.manual, 'rev', s.rev, 'estado', CASE WHEN s.manual THEN 'manual' ELSE 'salvo' END)
             ORDER BY s.variante_key, s.tamanho_key), '[]'::jsonb)
      INTO v_linhas
      FROM public.modelo_skus s
     WHERE s.modelo_id = _modelo_id;
    RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                              'linhas', v_linhas, 'faltas', '[]'::jsonb, 'avisos', '[]'::jsonb);
  END IF;

  WITH c AS (
    SELECT * FROM public._skus_calc_ref_tipo(_modelo_id, _ref, _tipo)
  ), s AS (
    SELECT sk.id, sk.variante_key, sk.tamanho_key, sk.sku, sk.manual, sk.rev
      FROM public.modelo_skus sk
     WHERE sk.modelo_id = _modelo_id
  ), j AS (
    SELECT c.variante_key AS c_vkey, s.variante_key AS s_vkey, c.variante_ordem AS vordem, c.cor_nome, c.apelido_nome,
           coalesce(c.tamanho_key, s.tamanho_key) AS tkey, c.tamanho_ordem AS tordem, c.sku AS previsto,
           coalesce(c.faltas, '[]'::jsonb) AS faltas, coalesce(c.avisos, '[]'::jsonb) AS avisos, s.id AS sid, s.sku AS salvo, s.manual, s.rev
      FROM c
      FULL JOIN s ON s.variante_key = c.variante_key AND s.tamanho_key = c.tamanho_key
  ), k AS (
    SELECT j.*,
           -- o SKU GRAVADO divide com outra linha que não é réplica (REF viva) — ex.: a REF de um card mudou (R2-a)
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.salvo AND o.id <> j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND coalesce(mo.modelo_base_id, mo.id) = v_familia  -- leves L3 sku #5
                        AND o.variante_key = coalesce(j.c_vkey, j.s_vkey) AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_salvo,
           -- o SKU PREVISTO (o que a geração gravaria) já é de outra linha que não é réplica
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.previsto AND o.id IS DISTINCT FROM j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
                        AND coalesce(mo.modelo_base_id, mo.id) = v_familia  -- leves L3 sku #5
                        AND o.variante_key = j.c_vkey AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_prev
      FROM j
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'variante_key', coalesce(k.c_vkey, k.s_vkey), 'variante_ordem', k.vordem,
           'cor_nome', k.cor_nome, 'apelido_nome', k.apelido_nome,
           'tamanho_key', k.tkey, 'tamanho_ordem', k.tordem,
           'id', k.sid, 'sku', k.salvo, 'manual', coalesce(k.manual, false), 'rev', k.rev,
           'sku_previsto', k.previsto, 'faltas', k.faltas, 'avisos', k.avisos,
           'conflito_com', coalesce(k.conflito_salvo, k.conflito_prev),
           'estado', CASE
             WHEN k.c_vkey IS NULL THEN 'orfa'
             WHEN k.conflito_salvo IS NOT NULL THEN 'conflito'
             WHEN k.manual IS TRUE THEN 'manual'
             WHEN jsonb_array_length(k.faltas) > 0 THEN 'falta'
             WHEN k.previsto IS NULL THEN 'vazio'
             WHEN k.salvo = k.previsto THEN 'ok'
             WHEN k.conflito_prev IS NOT NULL THEN 'conflito'
             WHEN k.salvo IS NULL THEN 'pendente'
             ELSE 'divergente'
           END)
           ORDER BY k.vordem NULLS LAST, k.tordem NULLS LAST, k.tkey), '[]'::jsonb)
    INTO v_linhas
    FROM k;

  SELECT coalesce(jsonb_agg(DISTINCT f.value ORDER BY f.value), '[]'::jsonb)
    INTO v_faltas
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'faltas') AS f(value)
   WHERE l.value ->> 'estado' = 'falta';

  SELECT coalesce(jsonb_agg(DISTINCT a.value ORDER BY a.value), '[]'::jsonb)
    INTO v_avisos
    FROM jsonb_array_elements(v_linhas) AS l(value)
    CROSS JOIN LATERAL jsonb_array_elements(l.value -> 'avisos') AS a(value);

  RETURN jsonb_build_object('status', v_status, 'tamanho_tipo', v_tipo, 'tamanho_tipo_card', v_tipo_card,
                            'linhas', v_linhas, 'faltas', v_faltas, 'avisos', v_avisos);
END
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
  v_erros text := '';
BEGIN
  FOR r IN SELECT assinatura, md5, papel FROM _l3s_md5_aceitos WHERE papel IN ('depois','dep') LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      v_erros := v_erros || format(' [%s %s md5 %s]', r.assinatura, r.papel, v_md5);
    END IF;
  END LOOP;
  IF v_erros <> '' THEN
    RAISE EXCEPTION 'leves_l3: pos-condicao falhou - texto inesperado:%', v_erros USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT assinatura, acl FROM _l3s_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l3: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: as 4 sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public.fn_modelo_skus_unico()'), ('public._skus_plano(uuid,text,text,jsonb,text)'),
                                 ('public._salvar_sku_manual_core(uuid,text,integer,uuid,uuid,text)'),
                                 ('public._skus_matriz_ref_tipo(uuid,text,text)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
