-- Integração/API — COR NO NOME DAS SUBLINHAS (P-126 + P-127 B, dono 29/set; P-128 A e P-129 A). Plano
-- .superpowers/sdd/2026-09-29-nome-cor/plan.md. GERADA por .superpowers/sdd/2026-09-29-nome-cor/mig/gerar.mjs a partir do texto
-- VIVO (pg_get_functiondef) da cópia = produção — NUNCA editar os corpos à mão (mude o gerador e gere de novo).
-- O que muda:
--   • Sublinha (variante x tamanho) passa a se chamar Nome do produto + COR + tamanho ("Vestido Suelen Preto PPP"): a cor é a
--     Cor base ou o Apelido conforme a escolha da loja em tenant_config.sku_config.cor_no_nome ('cor_base'|'cor_apelido'; sem a
--     chave = 'cor_apelido' se o Formato do SKU usa cor_apelido, senão 'cor_base' — SEM backfill). Apelido ausente → cor base;
--     sem cor → só nome + tamanho (como antes). ZERO DDL: a escolha mora no jsonb do Formato do SKU.
--   • _sku_config_normaliza MANTÉM/valida a chave (inválida = P0001); com partes [] e a chave, guarda
--     {"partes": [], "separadores": {}, "cor_no_nome": x} — por isso _skus_plano/_skus_matriz_ref_tipo passam a ler partes []
--     como SEM FORMATO (1 expressão cada; idêntico para toda linha que já existe).
--   • _integracao_retrato_core: o nome da sublinha vem de _integracao_nome_sublinha; o retrato passa a v = 2 (marcador de
--     idempotência — ninguém lê v). _integracao_exemplo (modo teste da API): "Produto Exemplo 1 Cor Exemplo P".
--   • P-127 B: integráveis com retrato v = 1 são REPROCESSADOS (só o nome das sublinhas + v = 2 + nova assinatura HMAC + rev);
--     integrados ficam intocados (conferido byte a byte). Um "editar" no Log da Integração por integrável REPROCESSADO (quem
--     "Sistema (cor no nome das sublinhas)"; detalhe com sublinhas = nº de nomes mudados (0 = só v/assinatura), nomes_antes
--     (só dos que mudaram), assinatura_antes/depois — é daí que o inverso restaura TODOS).
--   • P-129 A: no reprocesso a cor vem do RETRATO quando o campo da cor está marcado; o cadastro vivo só é lido quando a cor
--     que entra no nome NÃO está no retrato (e aí, variante não achada = recusa).
-- Contagens: +2 funções (IMMUTABLE), 5 redefinidas, 0 gatilhos, 0 tabelas/colunas/policies. ACL (#9): REVOKE das 7 de
-- PUBLIC/anon/authenticated. Trava: LOCK EXCLUSIVE em integracao_produtos/linhas (SELECT simples segue; marcar/voltar/
-- confirmar/trava FOR SHARE esperam — fecha a corrida de um marcar que calculou o retrato v1 antes do COMMIT) — não é DDL nem
-- tenant_config. Idempotente (guarda aceita antes OU depois; reaplicar reprocessa 0).
-- Inverso: supabase/rollback/20261013100000_integracao_nome_sublinha_cor_down.sql (LIFO: voltar a Integração exige voltar ESTA antes).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v text;
  v_n integer;
BEGIN
  IF to_regclass('public.integracao_produtos') IS NULL OR to_regclass('public.integracao_linhas') IS NULL
     OR to_regclass('public.integracao_log') IS NULL OR to_regclass('public.tenant_config') IS NULL
     OR to_regprocedure('public._integracao_assinar(jsonb)') IS NULL
     OR to_regprocedure('public._integracao_logar(uuid,text,uuid,jsonb,text)') IS NULL
     OR to_regprocedure('public._integracao_layout()') IS NULL
     OR to_regprocedure('public._skus_calc_ref_tipo(uuid,text,text)') IS NULL
     OR to_regprocedure('public._sku_variante_key(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'integracao_nome_cor: dependencia ausente (Integracao 1..6 / SKU em previa)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._sku_config_normaliza(jsonb)', '7714c95d1cc43e6da89c14e8090f46a0', '718520f22f4e6b23e0794657176c5449'),
      ('public._skus_plano(uuid,text,text,jsonb,text)', 'cb24674981bb1097e1dbd7698fdee6e3', '4c19c6a43934131a875dcd5509c1b800'),
      ('public._skus_matriz_ref_tipo(uuid,text,text)', 'f98ac370c499c823cb23bdb2b271f145', '953095062549ff98dcc83e9572f75a1f'),
      ('public._integracao_retrato_core(uuid,text[],jsonb)', 'b79ab7120a7f5b4d247b3daf0897eb78', '4cd22e4bb5bf081c1ac2fcf34d4a6cf2'),
      ('public._integracao_exemplo(text[],integer)', 'afdf0d5b61a99f8b049112b76c263cc1', 'a7b0687f4ef2503fba0d2b8f02718c95')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'integracao_nome_cor: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_cor_no_nome(jsonb)', '5180d729efa5e6d4b019f4d426ccdc04'),
      ('public._integracao_nome_sublinha(text,text,text,text,text)', '9fdfb0472cce4118f17bbda459122ecc')
    ) AS x(f, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.depois THEN
      RAISE EXCEPTION 'integracao_nome_cor: % ja existe com outro texto (md5 %)', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p WHERE p.estado = 'integravel' AND p.retrato ->> 'v' = '1';
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'integracao_nome_cor: % integraveis a reprocessar (teto 1000) - dividir a janela', v_n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_cor_no_nome(_cfg jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Cor no nome da sublinha (Integração, P-126): a escolha EXPLÍCITA do Formato do SKU (tenant_config.sku_config.cor_no_nome)
  -- quando válida; sem ela, 'cor_apelido' se as partes do SKU usam cor_apelido, senão 'cor_base'. NULL/qualquer outra coisa =
  -- 'cor_base'. Espelho TS: corNoNomeEfetiva (src/lib/sku-montar.ts); anti-drift tests/fixtures/nome-sublinha-casos.ts.
  SELECT CASE
           WHEN jsonb_typeof(_cfg) = 'object' AND (_cfg ->> 'cor_no_nome') IN ('cor_base', 'cor_apelido') THEN _cfg ->> 'cor_no_nome'
           WHEN jsonb_typeof(_cfg) = 'object' AND jsonb_typeof(_cfg -> 'partes') = 'array'
                AND (_cfg -> 'partes') @> '["cor_apelido"]'::jsonb THEN 'cor_apelido'
           ELSE 'cor_base'
         END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_nome_sublinha(_nome text, _cor_base text, _apelido text, _tamanho text, _modo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Nome da sublinha (variante x tamanho) da Integração/API (P-126): Nome do produto + cor + tamanho ("Vestido Suelen Preto
  -- PPP"). Nome em branco = NULL (falta o nome). Cor = o apelido no modo 'cor_apelido' (variante sem apelido: a cor base),
  -- senão a cor base; sem cor = nome + tamanho (como antes). btrim só tira ESPAÇO (tab/nbsp ficam), igual ao nome do produto.
  -- Espelho TS: nomeSublinha (src/lib/integracao/nome-sublinha.ts); anti-drift tests/fixtures/nome-sublinha-casos.ts.
  SELECT CASE
           WHEN nullif(btrim(_nome), '') IS NULL THEN NULL
           ELSE concat_ws(' ', btrim(_nome),
                  CASE WHEN _modo = 'cor_apelido' THEN coalesce(nullif(btrim(_apelido), ''), nullif(btrim(_cor_base), ''))
                       ELSE nullif(btrim(_cor_base), '') END,
                  nullif(_tamanho, ''))
         END
$function$;

CREATE OR REPLACE FUNCTION public._sku_config_normaliza(_c jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partes jsonb;
  v_seps jsonb;
  v_out_partes jsonb := '[]'::jsonb;
  v_out_seps jsonb := '{}'::jsonb;
  v_p jsonb;
  v_t text;
  v_prev text := NULL;
  v_sep jsonb;
  v_s text;
  v_cor text;
BEGIN
  IF _c IS NULL OR jsonb_typeof(_c) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(_c) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido.' USING ERRCODE = 'P0001';
  END IF;
  v_partes := _c -> 'partes';
  IF v_partes IS NULL OR jsonb_typeof(v_partes) = 'null' THEN
    v_partes := '[]'::jsonb;
  ELSIF jsonb_typeof(v_partes) <> 'array' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: partes.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_p IN SELECT e.value FROM jsonb_array_elements(v_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF jsonb_typeof(v_p) <> 'string' OR (v_p #>> '{}') NOT IN ('ref', 'cor_base', 'cor_apelido', 'tamanho') THEN
      RAISE EXCEPTION 'Parte do SKU desconhecida: %.', v_p::text USING ERRCODE = 'P0001';
    END IF;
    IF v_out_partes @> jsonb_build_array(v_p) THEN
      RAISE EXCEPTION 'Parte do SKU repetida: %.', v_p #>> '{}' USING ERRCODE = 'P0001';
    END IF;
    v_out_partes := v_out_partes || jsonb_build_array(v_p);
  END LOOP;
  -- Cor no nome da sublinha (Integração, P-126): 'cor_base' | 'cor_apelido'; ausente/null = fora da saída. Checada DEPOIS
  -- das partes (a ordem dos erros de antes fica igual). Sem partes, a chave SOZINHA fica guardada (loja sem Formato do SKU:
  -- {"partes": [], "separadores": {}, "cor_no_nome": x} — os leitores do SKU tratam partes [] como sem formato).
  IF _c -> 'cor_no_nome' IS NOT NULL AND jsonb_typeof(_c -> 'cor_no_nome') <> 'null' THEN
    IF jsonb_typeof(_c -> 'cor_no_nome') <> 'string' OR (_c ->> 'cor_no_nome') NOT IN ('cor_base', 'cor_apelido') THEN
      RAISE EXCEPTION 'Cor no nome da sublinha inválida (use cor_base ou cor_apelido).' USING ERRCODE = 'P0001';
    END IF;
    v_cor := _c ->> 'cor_no_nome';
  END IF;
  IF jsonb_array_length(v_out_partes) = 0 THEN
    IF v_cor IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('partes', '[]'::jsonb, 'separadores', '{}'::jsonb, 'cor_no_nome', v_cor);
  END IF;
  v_seps := _c -> 'separadores';
  IF v_seps IS NULL OR jsonb_typeof(v_seps) = 'null' THEN
    v_seps := '{}'::jsonb;
  ELSIF jsonb_typeof(v_seps) <> 'object' THEN
    RAISE EXCEPTION 'Formato do SKU inválido: separadores.' USING ERRCODE = 'P0001';
  END IF;
  FOR v_t IN SELECT e.value FROM jsonb_array_elements_text(v_out_partes) WITH ORDINALITY AS e(value, n) ORDER BY e.n LOOP
    IF v_prev IS NOT NULL THEN
      v_sep := v_seps -> (v_prev || '|' || v_t);
      IF v_sep IS NOT NULL AND jsonb_typeof(v_sep) <> 'null' THEN
        IF jsonb_typeof(v_sep) <> 'string' THEN
          RAISE EXCEPTION 'Separador do SKU inválido.' USING ERRCODE = 'P0001';
        END IF;
        v_s := v_sep #>> '{}';
        IF v_s !~ '^[-._/]*$' THEN
          RAISE EXCEPTION 'Separador do SKU: use só - . _ /.' USING ERRCODE = 'P0001';
        END IF;
        IF char_length(v_s) > 3 THEN
          RAISE EXCEPTION 'Separador do SKU: no máximo 3 caracteres.' USING ERRCODE = 'P0001';
        END IF;
        IF v_s <> '' THEN
          v_out_seps := v_out_seps || jsonb_build_object(v_prev || '|' || v_t, v_s);
        END IF;
      END IF;
    END IF;
    v_prev := v_t;
  END LOOP;
  -- F3.6 (dono 25/set): sem padrão da loja p/ o "Tamanho em" — a chave legada tamanho_padrao é IGNORADA (sem erro).
  RETURN jsonb_build_object('partes', v_out_partes, 'separadores', v_out_seps)
    || CASE WHEN v_cor IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('cor_no_nome', v_cor) END;
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
--     D5) = conflito, com as mensagens da F3.5a.
-- chave = variante_key || '|' || tamanho_key.
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_meu_nome text;
  v_meu_ref text;
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
  SELECT mo.tenant_id, public._sku_norm_ref(_ref), CASE WHEN tc.sku_config -> 'partes' = '[]'::jsonb THEN NULL ELSE tc.sku_config END, mo.nome, mo.ref
    INTO v_tenant, v_refn, v_cfg, v_meu_nome, v_meu_ref
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
           AND NOT (public._sku_norm_ref(mo.ref) = v_refn AND o.variante_key = r.variante_key AND o.tamanho_key = r.tamanho_key)
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

CREATE OR REPLACE FUNCTION public._skus_matriz_ref_tipo(_modelo_id uuid, _ref text, _tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_refn text;
  v_cfg jsonb;
  v_tipo_card text;
  v_tipo text;
  v_status text;
  v_linhas jsonb;
  v_faltas jsonb;
  v_avisos jsonb;
BEGIN
  SELECT mo.tenant_id, public._sku_norm_ref(_ref), CASE WHEN tc.sku_config -> 'partes' = '[]'::jsonb THEN NULL ELSE tc.sku_config END, _tipo  -- SKU em prévia: REF e "Tamanho em" por parâmetro
    INTO v_tenant, v_refn, v_cfg, v_tipo_card
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
                        AND o.variante_key = coalesce(j.c_vkey, j.s_vkey) AND o.tamanho_key = j.tkey)
             ORDER BY (o.modelo_id = _modelo_id) DESC, o.modelo_id
             LIMIT 1) AS conflito_salvo,
           -- o SKU PREVISTO (o que a geração gravaria) já é de outra linha que não é réplica
           (SELECT jsonb_build_object('modelo_id', o.modelo_id, 'nome', mo.nome, 'ref', mo.ref)
              FROM public.modelo_skus o
              JOIN public.modelos mo ON mo.id = o.modelo_id
             WHERE o.tenant_id = v_tenant AND o.sku = j.previsto AND o.id IS DISTINCT FROM j.sid
               AND NOT (o.modelo_id <> _modelo_id AND public._sku_norm_ref(mo.ref) = v_refn
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

CREATE OR REPLACE FUNCTION public._integracao_retrato_core(_modelo_id uuid, _campos text[], _custo jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_campos text[];
  v_rot jsonb := public._integracao_rotulos();
  v_kw text;
  v_loja_nome text;
  v_tipo text;
  v_custo numeric;
  v_titulo_auto text;
  v_preco_venda_efetivo numeric;
  c text;
  v_val jsonb;
  v_prod jsonb := '{}'::jsonb;
  v_fotos text[] := '{}'::text[];
  v_linhas jsonb := '[]'::jsonb;
  v_meta jsonb := '[]'::jsonb;
  v_faltas jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_sem_sku integer := 0;
  v_ex_sku text;
  v_sem_cor integer := 0;
  v_sem_tam integer := 0;
  v_tam text;
  v_linha jsonb;
  v_chaves uuid[];
  s record;
  v_skucfg jsonb;
  v_modo text;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- só chaves conhecidas, na ORDEM FIXA do layout (P-60 B)
  v_campos := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                     WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  SELECT tc.keywords, tc.sku_config INTO v_kw, v_skucfg FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id;
  -- Cor no nome da sublinha (P-126): Cor base | Apelido da loja (a escolha do Formato do SKU, senão derivada das partes)
  v_modo := public._integracao_cor_no_nome(v_skucfg);
  v_tipo := coalesce(m.tamanho_tipo, 'letra');
  v_custo := CASE WHEN coalesce((_custo ->> 'confirmado')::boolean, false) THEN (_custo ->> 'real')::numeric
                  ELSE (_custo ->> 'previsto')::numeric END;
  -- ruling do controlador, G-migration fix 1 #G1 (A-I1 + B-I-1): titulo_pagina/preco_anterior NULL = automatico
  -- (contrato da coluna, 20261005100000:760/:766) — o retrato NUNCA le cru (senão TODO produto nasce com falta,
  -- 272/272 na copia). Titulo automatico = _titulo_pagina_calculado(nome, tenants.nome — a MARCA da loja).
  SELECT t.nome INTO v_loja_nome FROM public.tenants t WHERE t.id = m.tenant_id;
  v_titulo_auto := nullif(public._titulo_pagina_calculado(m.nome, v_loja_nome), '');
  -- Preco anterior automatico = acompanha o preco de venda EFETIVO — a MESMA expressao que o retrato usa para
  -- "Preço de venda" (campo 'preco_venda' abaixo: m.preco_venda, sem outra fonte de preco efetivo nesta funcao).
  v_preco_venda_efetivo := m.preco_venda;

  -- linha do PRODUTO
  FOREACH c IN ARRAY v_campos LOOP
    CONTINUE WHEN c = 'foto';
    IF c IN ('cor_base', 'cor_apelido', 'tamanho') THEN
      v_prod := v_prod || jsonb_build_object(c, NULL::text);  -- "só variante": vazia na linha do produto
      CONTINUE;
    END IF;
    v_val := CASE c
      WHEN 'nome' THEN to_jsonb(nullif(btrim(m.nome), ''))
      WHEN 'ref_sku' THEN to_jsonb(nullif(btrim(coalesce(m.ref, '')), ''))
      WHEN 'preco_anterior' THEN to_jsonb(public._integracao_num(coalesce(m.preco_anterior, v_preco_venda_efetivo), 2))
      WHEN 'preco_venda' THEN to_jsonb(public._integracao_num(m.preco_venda, 2))
      WHEN 'peso' THEN to_jsonb(public._integracao_num(m.peso_kg, 3))
      WHEN 'ncm' THEN to_jsonb(nullif(btrim(coalesce(m.ncm, '')), ''))
      WHEN 'preco_custo' THEN to_jsonb(public._integracao_num(v_custo, 2))
      WHEN 'titulo' THEN to_jsonb(coalesce(nullif(btrim(coalesce(m.titulo_pagina, '')), ''), v_titulo_auto))
      WHEN 'descricao' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'keywords' THEN to_jsonb(nullif(btrim(coalesce(v_kw, '')), ''))
      WHEN 'metatag' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'comprimento' THEN to_jsonb(public._integracao_num(m.comprimento_cm, NULL))
      WHEN 'largura' THEN to_jsonb(public._integracao_num(m.largura_cm, NULL))
      WHEN 'altura' THEN to_jsonb(public._integracao_num(m.altura_cm, NULL))
    END;
    v_prod := v_prod || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    IF v_val IS NULL THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', c, 'texto',
        CASE c WHEN 'ref_sku' THEN 'REF' WHEN 'preco_custo' THEN 'Preço de custo (o estimado não conta)'
               ELSE v_rot ->> c END));
    END IF;
  END LOOP;

  -- SUBLINHAS: variante × tamanho com grade > 0 (mesma matriz do SKU) + o SKU GRAVADO (D7)
  FOR s IN
    SELECT k.variante_key, k.variante_ordem, k.cor_nome, k.apelido_nome, k.tamanho_key, k.tamanho_ordem,
           sk.id AS sku_id, sk.sku AS sku, sk.rev AS sku_rev, sk.manual AS manual
      FROM public._skus_calc_ref_tipo(m.id, m.ref, v_tipo) k
      LEFT JOIN public.modelo_skus sk
        ON sk.modelo_id = m.id AND sk.variante_key = k.variante_key AND sk.tamanho_key = k.tamanho_key
     ORDER BY k.variante_ordem NULLS LAST, k.tamanho_ordem NULLS LAST, k.tamanho_key, k.variante_key
  LOOP
    v_n := v_n + 1;
    v_tam := nullif(coalesce(public._sku_tamanho_lado(s.tamanho_key, v_tipo), s.tamanho_key), '');
    v_linha := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      CONTINUE WHEN c = 'foto';
      v_linha := v_linha || jsonb_build_object(c, CASE c
        WHEN 'nome' THEN coalesce(to_jsonb(public._integracao_nome_sublinha(m.nome, s.cor_nome, s.apelido_nome, v_tam, v_modo)), 'null'::jsonb)
        WHEN 'ref_sku' THEN coalesce(to_jsonb(nullif(btrim(coalesce(s.sku, '')), '')), 'null'::jsonb)
        WHEN 'cor_base' THEN coalesce(to_jsonb(s.cor_nome), 'null'::jsonb)
        WHEN 'cor_apelido' THEN coalesce(to_jsonb(s.apelido_nome), 'null'::jsonb)
        WHEN 'tamanho' THEN coalesce(to_jsonb(v_tam), 'null'::jsonb)
        ELSE coalesce(v_prod -> c, 'null'::jsonb)
      END);
    END LOOP;
    IF 'ref_sku' = ANY(v_campos) AND nullif(btrim(coalesce(s.sku, '')), '') IS NULL THEN
      v_sem_sku := v_sem_sku + 1;
      IF v_ex_sku IS NULL THEN
        v_ex_sku := coalesce(s.cor_nome, 'sem cor') || ', tam. ' || coalesce(v_tam, s.tamanho_key);
      END IF;
    END IF;
    IF 'cor_base' = ANY(v_campos) AND s.cor_nome IS NULL THEN
      v_sem_cor := v_sem_cor + 1;
    END IF;
    IF 'tamanho' = ANY(v_campos) AND v_tam IS NULL THEN
      v_sem_tam := v_sem_tam + 1;
    END IF;
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'tipo', 'variante', 'ordem', v_n, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key,
      'valores', v_linha, 'fotos', '[]'::jsonb));
    v_meta := v_meta || jsonb_build_array(jsonb_build_object(
      'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'variante_ordem', s.variante_ordem,
      'tamanho_ordem', s.tamanho_ordem, 'cor_nome', s.cor_nome, 'apelido_nome', s.apelido_nome, 'tamanho', v_tam,
      'sku_id', s.sku_id, 'sku', s.sku, 'sku_rev', s.sku_rev, 'manual', coalesce(s.manual, false)));
  END LOOP;

  IF v_n = 0 AND v_campos && ARRAY['ref_sku', 'cor_base', 'cor_apelido', 'tamanho']::text[] THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'variantes', 'texto', 'variantes cor × tamanho'));
  END IF;
  IF v_sem_sku = 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto', '1 variante sem SKU (' || v_ex_sku || ')'));
  ELSIF v_sem_sku > 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto',
      v_sem_sku || ' variantes sem SKU (ex.: ' || v_ex_sku || ')'));
  END IF;
  IF v_sem_cor > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cor_base', 'texto', v_sem_cor || ' variante(s) sem cor base'));
  END IF;
  IF v_sem_tam > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tamanho', 'texto', v_sem_tam || ' variante(s) sem tamanho'));
  END IF;
  -- ruling do controlador, revisão T2 Minor #5: "Tamanho em" NULL nunca é assumido como letra em silêncio — vira
  -- falta sempre que tamanho/ref_sku estiver marcado (mesmo v_tipo continuando 'letra' só para montar a matriz acima).
  IF m.tamanho_tipo IS NULL AND v_campos && ARRAY['tamanho', 'ref_sku']::text[] THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tamanho_tipo', 'texto', 'Tamanho em'));
  END IF;

  -- FOTOS (só se "Foto do Modelo" marcado): modelos.fotos_modelo nas 3 origens (B1b)
  IF 'foto' = ANY(v_campos) THEN
    v_fotos := coalesce(m.fotos_modelo, '{}'::text[]);
    IF cardinality(v_fotos) = 0 THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'Foto do Modelo'));
    -- Minor #6: além do prefixo <tenant>/, falha fechado em qualquer segmento '..'/'.'/vazio (rejeita '//','/./','/../')
    ELSIF EXISTS (SELECT 1 FROM unnest(v_fotos) AS p(x)
                   WHERE p.x IS NULL OR NOT starts_with(p.x, m.tenant_id::text || '/')
                      OR EXISTS (SELECT 1 FROM unnest(string_to_array(p.x, '/')) AS seg(s) WHERE seg.s IN ('', '.', '..'))) THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'foto de outra loja'));
    END IF;
  END IF;

  -- conjunto de cores do ESPELHO do comprado (trava das variantes — D11)
  IF m.origem = 'revenda' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(pv.cor_id, pv.cor_apelido_id)
                        FROM public.produtos_acabados pa
                        JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
                       WHERE pa.modelo_id = m.id ORDER BY 1);
  ELSIF m.origem = 'importado' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(iv.cor_id, iv.cor_apelido_id)
                        FROM public.produtos_importados pi
                        JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
                       WHERE pi.modelo_id = m.id ORDER BY 1);
  END IF;

  -- ruling do controlador, revisão T4 #1 (Important #1, opção b) + re-review A (Important, residual do #1):
  -- 'nome' marcado em produto revenda/importado vira falta quando o nome do card (modelos.nome) diverge do
  -- nome do PRODUTO ESPELHO. O card do Produto Acabado (_salvar_produto_acabado_core) sempre copia
  -- produtos_acabados.nome -> modelos.nome a cada save — se o usuário renomeou só o card no Sheet do
  -- Planejamento, todo save do PA volta a travar com integracao_travado: nome mesmo sem editar nada de fato.
  -- A falta avisa ANTES do marcar (o retrato fica incompleto e marcar recusa) em vez de deixar o produto
  -- travado destravável só por voltar/desfazer. _salvar_produto_importado_core NÃO grava nome/ref em modelos
  -- (confirmado lendo 20260904180000_produto_importado_fixes_review.sql) — mas a checagem entra igual para o
  -- importado por SIMETRIA/robustez a uma mudança futura desse core (o teste cobre só o caso revenda, que é
  -- o alcançável hoje). Re-review A: a comparação tem que ser EXATA como o save do espelho grava e como a
  -- trava (fn_integracao_trava_modelos, NEW.nome IS DISTINCT FROM OLD.nome) compara — SEM btrim. O
  -- _salvar_produto_acabado_core grava `v_nome := nullif(_dados->>'nome','')` (raw, sem trim) direto em
  -- modelos.nome; comparar com btrim aqui deixava passar uma diferença SÓ de espaço ('Blusa ' × 'Blusa'),
  -- que a trava recusaria do mesmo jeito (ela também não faz trim) — o mesmo beco sem saída que a falta foi
  -- criada pra evitar. Fix: `nullif(x,'') IS DISTINCT FROM nullif(y,'')` dos dois lados (raw, não btrim) —
  -- '' e NULL contam como iguais (o mesmo `nullif` que o _core usa), mas qualquer outra diferença, inclusive
  -- só de espaço, vira falta.
  IF 'nome' = ANY(v_campos) THEN
    IF m.origem = 'revenda' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_acabados pa
                  WHERE pa.modelo_id = m.id
                    AND nullif(pa.nome::text, '') IS DISTINCT FROM nullif(m.nome::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'nome',
          'texto', 'Nome diferente do Produto Acabado'));
      END IF;
    ELSIF m.origem = 'importado' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_importados pi
                  WHERE pi.modelo_id = m.id
                    AND nullif(pi.nome::text, '') IS DISTINCT FROM nullif(m.nome::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'nome',
          'texto', 'Nome diferente do Produto Importado'));
      END IF;
    END IF;
  END IF;

  -- ruling do controlador, revisão T5 #2 (Important #1 parte 2, plan-mandated): mesmo padrão da falta de nome
  -- acima, agora para REF — 'ref_sku' marcado e a REF do card diferente da REF do espelho vira falta ANTES do
  -- marcar (o usuário vê e resolve igualando as REFs, em vez de a mão dupla da migration 5 sobrescrever uma REF
  -- em silêncio). Comparação EXATA (nullif dos dois lados, sem btrim) — mesmo estilo da falta de nome. A
  -- reconciliação ÚNICA dos 34 pares já divergentes na cópia (achado da revisão) fica PENDENTE de decisão do
  -- dono — nenhum backfill é feito aqui, só o check daqui pra frente.
  IF 'ref_sku' = ANY(v_campos) THEN
    IF m.origem = 'revenda' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_acabados pa
                  WHERE pa.modelo_id = m.id
                    AND nullif(pa.ref::text, '') IS DISTINCT FROM nullif(m.ref::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku',
          'texto', 'REF diferente do Produto Acabado'));
      END IF;
    ELSIF m.origem = 'importado' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_importados pi
                  WHERE pi.modelo_id = m.id
                    AND nullif(pi.ref::text, '') IS DISTINCT FROM nullif(m.ref::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku',
          'texto', 'REF diferente do Produto Importado'));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'retrato', jsonb_build_object('v', 2, 'campos', to_jsonb(v_campos),
      'linhas', jsonb_build_array(jsonb_build_object('tipo', 'produto', 'ordem', 0, 'valores', v_prod,
                                                      'fotos', to_jsonb(v_fotos))) || v_linhas),
    'faltas', v_faltas,
    'completo', jsonb_array_length(v_faltas) = 0,
    'variantes_chaves', to_jsonb(v_chaves),
    'meta', v_meta);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_exemplo(_campos text[], _pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[] := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                            WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  v_pag integer := least(greatest(coalesce(_pagina, 1), 1), 2);
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_ref text;
  v_nome text;
  v_desc text;
  v_base jsonb;
  v_linha jsonb;
  v_linhas jsonb;
  v_tam text;
BEGIN
  -- P-82 A: produtos FICTÍCIOS no formato real (mesmas colunas marcadas da loja), 2 por página, 2 páginas. NUNCA lê produto.
  FOR v_i IN ((v_pag - 1) * 2 + 1)..((v_pag - 1) * 2 + 2) LOOP
    v_ref := 'EXPL' || lpad(v_i::text, 4, '0');
    v_nome := 'Produto Exemplo ' || v_i;
    v_desc := 'Descrição de exemplo do produto ' || v_i || '.';
    v_base := jsonb_build_object('nome', v_nome, 'ref_sku', v_ref, 'preco_anterior', '109.90', 'preco_venda', '99.90',
      'peso', '0.300', 'ncm', '6109.10.00', 'preco_custo', '42.00', 'cor_base', NULL, 'cor_apelido', NULL, 'tamanho', NULL,
      'titulo', v_nome || ' - exemplo', 'descricao', v_desc, 'keywords', 'exemplo, teste', 'metatag', v_desc,
      'comprimento', '60', 'largura', '40', 'altura', '2');
    v_linhas := jsonb_build_array(jsonb_build_object('tipo', 'produto', 'valores',
      (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '["exemplo"]'::jsonb ELSE coalesce(v_base -> u.x, 'null'::jsonb) END
                                 ORDER BY u.n), '[]'::jsonb)
         FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    FOREACH v_tam IN ARRAY ARRAY['P', 'M'] LOOP
      v_linha := v_base || jsonb_build_object('nome', v_nome || ' Cor Exemplo ' || v_tam, 'ref_sku', v_ref || '-COR-' || v_tam,
        'cor_base', 'Cor Exemplo', 'cor_apelido', 'Apelido Exemplo', 'tamanho', v_tam);
      v_linhas := v_linhas || jsonb_build_array(jsonb_build_object('tipo', 'variante', 'valores',
        (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '[]'::jsonb ELSE coalesce(v_linha -> u.x, 'null'::jsonb) END
                                   ORDER BY u.n), '[]'::jsonb)
           FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object('modelo_id', 'exemplo-' || lpad(v_i::text, 4, '0'),
      'estado', 'teste', 'assinatura', NULL, 'integrado_em', NULL, 'linhas', v_linhas));
  END LOOP;
  RETURN jsonb_build_object('produtos', v_out, 'proximo_cursor',
    CASE WHEN v_pag = 1 THEN to_jsonb(encode(convert_to('{"exemplo": 2}', 'UTF8'), 'base64')) ELSE 'null'::jsonb END);
END
$function$;

REVOKE EXECUTE ON FUNCTION
  public._integracao_cor_no_nome(jsonb),
  public._integracao_nome_sublinha(text, text, text, text, text),
  public._sku_config_normaliza(jsonb),
  public._skus_plano(uuid, text, text, jsonb, text),
  public._skus_matriz_ref_tipo(uuid, text, text),
  public._integracao_retrato_core(uuid, text[], jsonb),
  public._integracao_exemplo(text[], integer)
  FROM PUBLIC, anon, authenticated;

LOCK TABLE public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;

-- P-127 B: integráveis com retrato v = 1 → só o NOME das sublinhas (+ v = 2, assinatura, rev). Integrados e o resto intocados.
DO $reprocessa$
DECLARE
  ip record;
  l jsonb;
  v_ids uuid[];
  v_mids uuid[];
  v_ret jsonb;
  v_campos text[];
  v_modo text;
  v_origem text;
  v_nome text;
  v_linhas jsonb;
  v_antigo text;
  v_novo text;
  v_tam text;
  v_cor text;
  v_ap text;
  v_cor_viva text;
  v_ap_viva text;
  v_achou boolean;
  v_vk uuid;
  v_sem_cor uuid := public._sku_variante_key(NULL::uuid, NULL::uuid);
  v_mudou integer;
  v_nomes_antes jsonb;
  v_ex jsonb;
  v_ass text;
  v_upd integer;
  v_n_prod integer := 0;
  v_n_log integer := 0;
  v_n_com_nome integer := 0;
  v_n_sub integer := 0;
  v_intocados_antes text;
  v_intocados_depois text;
BEGIN
  v_ids := ARRAY(SELECT p.id FROM public.integracao_produtos p
                  WHERE p.estado = 'integravel' AND p.retrato ->> 'v' = '1' ORDER BY p.modelo_id);
  v_mids := ARRAY(SELECT p.modelo_id FROM public.integracao_produtos p WHERE p.id = ANY(v_ids));
  -- tudo o que NÃO é reprocessado (integrados inclusive) — foto antes; conferida no fim deste bloco
  SELECT md5(coalesce((SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.integracao_produtos p WHERE p.id <> ALL(v_ids)), '')
          || '#' || coalesce((SELECT string_agg(il::text, '|' ORDER BY il.id) FROM public.integracao_linhas il
                               WHERE il.modelo_id <> ALL(v_mids)), ''))
    INTO v_intocados_antes;
  FOR ip IN
    SELECT p.id, p.tenant_id, p.modelo_id, p.retrato, p.assinatura
      FROM public.integracao_produtos p
     WHERE p.id = ANY(v_ids)
     ORDER BY p.modelo_id
       FOR UPDATE
  LOOP
    v_ret := ip.retrato;
    v_campos := ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(v_ret -> 'campos') = 'array'
                                                            THEN v_ret -> 'campos' ELSE '[]'::jsonb END));
    v_modo := public._integracao_cor_no_nome((SELECT tc.sku_config FROM public.tenant_config tc WHERE tc.tenant_id = ip.tenant_id));
    SELECT coalesce(m.origem, 'interno') INTO v_origem FROM public.modelos m WHERE m.id = ip.modelo_id;
    v_nome := (SELECT e.x -> 'valores' ->> 'nome' FROM jsonb_array_elements(v_ret -> 'linhas') AS e(x)
                WHERE e.x ->> 'tipo' = 'produto' LIMIT 1);
    v_linhas := '[]'::jsonb;
    v_mudou := 0;
    v_nomes_antes := '[]'::jsonb;
    v_ex := NULL;
    FOR l IN SELECT e.x FROM jsonb_array_elements(v_ret -> 'linhas') WITH ORDINALITY AS e(x, n) ORDER BY e.n LOOP
      IF 'nome' = ANY(v_campos) AND v_nome IS NOT NULL AND l ->> 'tipo' = 'variante' THEN
        v_antigo := l -> 'valores' ->> 'nome';
        -- tamanho = o que o nome antigo tinha depois do nome do produto (concat_ws(' ', nome, tam))
        IF v_antigo = v_nome THEN
          v_tam := NULL;
        ELSIF v_antigo IS NOT NULL AND left(v_antigo, length(v_nome) + 1) = v_nome || ' ' THEN
          v_tam := substr(v_antigo, length(v_nome) + 2);
        ELSE
          RAISE EXCEPTION 'integracao_nome_cor: nome da sublinha fora do padrao (modelo %, ordem %)', ip.modelo_id, l ->> 'ordem'
            USING ERRCODE = 'P0001';
        END IF;
        IF 'tamanho' = ANY(v_campos) AND (l -> 'valores' ->> 'tamanho') IS DISTINCT FROM v_tam THEN
          RAISE EXCEPTION 'integracao_nome_cor: tamanho da sublinha nao confere com o nome (modelo %, ordem %)', ip.modelo_id, l ->> 'ordem'
            USING ERRCODE = 'P0001';
        END IF;
        -- P-129 A: a cor do RETRATO quando o campo está marcado; o nome VIVO da variante (3 origens, sem filtro de grade) só é
        -- lido quando a cor que entra no nome NÃO está no retrato: modo Cor base sem cor_base marcado; modo Apelido sem
        -- cor_apelido marcado, ou com ele marcado mas VAZIO (variante sem apelido ⇒ a cor base) e cor_base não marcado.
        v_vk := (l ->> 'variante_key')::uuid;
        v_cor_viva := NULL;
        v_ap_viva := NULL;
        IF v_vk IS DISTINCT FROM v_sem_cor
           AND (CASE WHEN v_modo = 'cor_apelido'
                     THEN NOT ('cor_apelido' = ANY(v_campos))
                          OR (nullif(btrim(l -> 'valores' ->> 'cor_apelido'), '') IS NULL AND NOT ('cor_base' = ANY(v_campos)))
                     ELSE NOT ('cor_base' = ANY(v_campos)) END) THEN
          v_achou := false;
          SELECT c.nome::text, a.nome::text, true INTO v_cor_viva, v_ap_viva, v_achou
            FROM (SELECT vt.cor_id AS vcor, vt.cor_apelido_id AS vapelido, mtv.ordem AS vordem
                    FROM public.modelo_tecidos mt
                    JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = mt.id
                    JOIN public.variantes_tecido vt ON vt.id = mtv.variante_tecido_id
                   WHERE v_origem = 'interno' AND mt.modelo_id = ip.modelo_id AND mt.tipo = 'tecido' AND mt.numero = 1
                  UNION ALL
                  SELECT pv.cor_id, pv.cor_apelido_id, pv.ordem
                    FROM public.produtos_acabados pa
                    JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
                   WHERE v_origem = 'revenda' AND pa.modelo_id = ip.modelo_id
                  UNION ALL
                  SELECT iv.cor_id, iv.cor_apelido_id, iv.ordem
                    FROM public.produtos_importados pi
                    JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
                   WHERE v_origem = 'importado' AND pi.modelo_id = ip.modelo_id) AS va
            LEFT JOIN public.cores c ON c.id = va.vcor
            LEFT JOIN public.cores_apelido a ON a.id = va.vapelido
           WHERE public._sku_variante_key(va.vcor, va.vapelido) = v_vk
           ORDER BY va.vordem NULLS LAST
           LIMIT 1;
          IF NOT coalesce(v_achou, false) THEN
            RAISE EXCEPTION 'integracao_nome_cor: variante da sublinha nao encontrada no cadastro (modelo %, ordem %)', ip.modelo_id,
              l ->> 'ordem' USING ERRCODE = 'P0001';
          END IF;
        END IF;
        v_cor := CASE WHEN 'cor_base' = ANY(v_campos) THEN l -> 'valores' ->> 'cor_base' ELSE v_cor_viva END;
        v_ap := CASE WHEN 'cor_apelido' = ANY(v_campos) THEN l -> 'valores' ->> 'cor_apelido' ELSE v_ap_viva END;
        v_novo := public._integracao_nome_sublinha(v_nome, v_cor, v_ap, v_tam, v_modo);
        v_nomes_antes := v_nomes_antes || jsonb_build_array(jsonb_build_object('ordem', (l ->> 'ordem')::integer, 'nome', v_antigo));
        IF v_novo IS DISTINCT FROM v_antigo THEN
          v_mudou := v_mudou + 1;
          IF v_ex IS NULL THEN
            v_ex := jsonb_build_object('antes', v_antigo, 'depois', v_novo);
          END IF;
          l := jsonb_set(l, '{valores,nome}', coalesce(to_jsonb(v_novo), 'null'::jsonb));
        END IF;
      END IF;
      v_linhas := v_linhas || jsonb_build_array(l);
    END LOOP;
    v_ret := jsonb_set(jsonb_set(v_ret, '{linhas}', v_linhas), '{v}', '2'::jsonb);
    v_ass := public._integracao_assinar(v_ret);
    UPDATE public.integracao_produtos
       SET retrato = v_ret, assinatura = v_ass, rev = rev + 1, atualizado_em = now()
     WHERE id = ip.id;
    v_n_prod := v_n_prod + 1;
    IF v_mudou > 0 THEN
      v_n_com_nome := v_n_com_nome + 1;
      v_n_sub := v_n_sub + v_mudou;
      FOR l IN SELECT e.x FROM jsonb_array_elements(v_linhas) AS e(x) WHERE e.x ->> 'tipo' = 'variante' LOOP
        UPDATE public.integracao_linhas il
           SET nome = l -> 'valores' ->> 'nome'
         WHERE il.modelo_id = ip.modelo_id AND il.ordem = (l ->> 'ordem')::integer AND il.tipo = 'variante';
        GET DIAGNOSTICS v_upd = ROW_COUNT;
        IF v_upd <> 1 THEN
          RAISE EXCEPTION 'integracao_nome_cor: linha da API ausente (modelo %, ordem %)', ip.modelo_id, l ->> 'ordem'
            USING ERRCODE = 'P0001';
        END IF;
      END LOOP;
    END IF;
    -- TODO integrável reprocessado ganha o registro (também sem nome mudado: sublinhas 0, nomes_antes []) — o inverso o restaura
    PERFORM public._integracao_logar(ip.tenant_id, 'editar', ip.modelo_id,
      jsonb_build_object('reprocesso', 'nome_sublinhas_cor', 'cor_no_nome', v_modo, 'sublinhas', v_mudou, 'exemplo', v_ex,
                         'nomes_antes', CASE WHEN v_mudou > 0 THEN v_nomes_antes ELSE '[]'::jsonb END,
                         'assinatura_antes', ip.assinatura, 'assinatura_depois', v_ass),
      'Sistema (cor no nome das sublinhas)');
    v_n_log := v_n_log + 1;
  END LOOP;
  SELECT md5(coalesce((SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.integracao_produtos p WHERE p.id <> ALL(v_ids)), '')
          || '#' || coalesce((SELECT string_agg(il::text, '|' ORDER BY il.id) FROM public.integracao_linhas il
                               WHERE il.modelo_id <> ALL(v_mids)), ''))
    INTO v_intocados_depois;
  IF v_intocados_depois IS DISTINCT FROM v_intocados_antes THEN
    RAISE EXCEPTION 'integracao_nome_cor: integrados/outros produtos mudaram no reprocesso' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'integracao_nome_cor: % integravel(is) reprocessado(s) (% registro(s) no Log); % com nome mudado (% sublinhas)',
    v_n_prod, v_n_log, v_n_com_nome, v_n_sub;
END
$reprocessa$;

DO $pos$
DECLARE
  r record;
  v text;
  v_n integer;
  v_tag text := 'integracao_nome_cor';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_cor_no_nome(jsonb)', '5180d729efa5e6d4b019f4d426ccdc04'),
      ('public._integracao_nome_sublinha(text,text,text,text,text)', '9fdfb0472cce4118f17bbda459122ecc'),
      ('public._sku_config_normaliza(jsonb)', '718520f22f4e6b23e0794657176c5449'),
      ('public._skus_plano(uuid,text,text,jsonb,text)', '4c19c6a43934131a875dcd5509c1b800'),
      ('public._skus_matriz_ref_tipo(uuid,text,text)', '953095062549ff98dcc83e9572f75a1f'),
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '4cd22e4bb5bf081c1ac2fcf34d4a6cf2'),
      ('public._integracao_exemplo(text[],integer)', 'a7b0687f4ef2503fba0d2b8f02718c95')
    ) AS x(f, md5) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'integracao_nome_cor: pos-condicao falhou em % (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_cor_no_nome(jsonb)', '5180d729efa5e6d4b019f4d426ccdc04'),
      ('public._integracao_nome_sublinha(text,text,text,text,text)', '9fdfb0472cce4118f17bbda459122ecc'),
      ('public._sku_config_normaliza(jsonb)', '718520f22f4e6b23e0794657176c5449'),
      ('public._skus_plano(uuid,text,text,jsonb,text)', '4c19c6a43934131a875dcd5509c1b800'),
      ('public._skus_matriz_ref_tipo(uuid,text,text)', '953095062549ff98dcc83e9572f75a1f'),
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '4cd22e4bb5bf081c1ac2fcf34d4a6cf2'),
      ('public._integracao_exemplo(text[],integer)', 'a7b0687f4ef2503fba0d2b8f02718c95')
    ) AS x(f, md5) LOOP
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)),
                    acldefault('f', (SELECT p.proowner FROM pg_proc p WHERE p.oid = to_regprocedure(r.f))))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION '%: % executavel por PUBLIC/anon/authenticated (inv. 9)', v_tag, r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p WHERE p.estado = 'integravel' AND p.retrato ->> 'v' = '1';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'integracao_nome_cor: % integravel(is) ainda com retrato v1', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado') AND p.retrato IS NOT NULL
     AND p.assinatura IS DISTINCT FROM public._integracao_assinar(p.retrato);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'integracao_nome_cor: % assinatura(s) nao conferem com o retrato', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND p.retrato IS NOT NULL
     AND ((SELECT count(*) FROM public.integracao_linhas il WHERE il.modelo_id = p.modelo_id) <> jsonb_array_length(p.retrato -> 'linhas')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.retrato -> 'linhas') AS e(x)
                       LEFT JOIN public.integracao_linhas il ON il.modelo_id = p.modelo_id AND il.ordem = (e.x ->> 'ordem')::integer
                      WHERE il.id IS NULL OR il.tipo IS DISTINCT FROM e.x ->> 'tipo'
                         OR il.nome IS DISTINCT FROM e.x -> 'valores' ->> 'nome'));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'integracao_nome_cor: % integravel(is) com linhas da API diferentes do retrato', v_n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
