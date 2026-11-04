-- Camada intermediaria / "Salvar por card" do Plan. Tecido — Tarefa 2 (banco).
-- RPC NOVA `salvar_variante_tecido(_id, _mudancas, _base, _assinatura)`: grava UMA cor/variante de tecido (`variantes_tecido`)
-- so no Salvar do card, com compare-and-set POR CAMPO (mesmo desenho de `salvar_config_loja`, 20261015100000).
--   * `variantes_tecido` NAO tem `rev` proprio (o `rev` colaborativo vive em `artigos`, pai) -> nada de `_rev_base`; a concorrencia
--     e por campo: so grava as chaves de `_mudancas`; campo que mudou no servidor (!= `_base`) E != o valor que eu gravaria =
--     P0409 `conflito_versao: variante_tecido` (ASCII, DETAIL = campos em conflito), NADA gravado (tudo ou nada).
--     Convergencia (outra pessoa ja gravou o mesmo valor que eu ia gravar) NAO e conflito.
--   * Chaves aceitas: cor_id, cor_apelido_id, nome_variante, codigo_variante, preco. NUNCA foto_url, historico_precos, enderecos,
--     rua, prateleira, artigo_id (foto/enderecos gravam na hora pelo caminho proprio; historico e do gatilho).
--     `preco` vazio/null grava NULL (nunca 0). Texto/uuid vazio ('') conta como NULL (igual ao NULLIF do UPDATE).
--   * Loja: a linha e travada (FOR UPDATE) e o artigo dela tem de ser da loja do chamador; variante de outra loja e id
--     inexistente dao o MESMO erro (P0002 nao_encontrado, sem oraculo cross-tenant).
--   * Wrapper: login + loja ativa + modulo `cadastro` (Reforco D2 A: Cadastro NAO e trancado por pagina no servidor — decisao,
--     nao furo). Quando `preco` esta em `_mudancas` valida a assinatura da previa por `_variante_tecido_preco_assinatura_ok`.
--   * `_variante_tecido_preco_assinatura_ok` aqui e um STUB PERMISSIVO (ruling de pre-flight T2<->T3: mesma migration); a Tarefa 3
--     o SUBSTITUI pela implementacao real e acrescenta as funcoes de previa antes dele.
--   * ACL (inv. 9): `_salvar_variante_tecido_core` e o helper com REVOKE dos TRES (PUBLIC, anon, authenticated); o wrapper vai a
--     authenticated + service_role. Mensagens de P0409/P0002 SO ASCII (PostgREST: nao-ASCII vira 500 e o code some).
--   * ZERO DDL em tabela (so CREATE OR REPLACE FUNCTION + REVOKE/GRANT): nenhuma trava de tabela, nada em auth/storage.
-- Idempotente. Inverso: supabase/rollback/20261103165000_camada_salvar_variante_tecido_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regclass('public.variantes_tecido') IS NULL
     OR to_regclass('public.artigos') IS NULL
     OR to_regprocedure('public.get_user_tenant_id()') IS NULL
     OR to_regprocedure('public.meu_tenant_ativo()') IS NULL
     OR to_regprocedure('public._exige_modulos(text[])') IS NULL THEN
    RAISE EXCEPTION 'camada_salvar_variante_tecido: variantes_tecido/artigos/get_user_tenant_id/meu_tenant_ativo/_exige_modulos ausente'
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- 1. STUB permissivo da assinatura da previa (Tarefa 3 substitui). Ordenado ANTES do wrapper.
CREATE OR REPLACE FUNCTION public._variante_tecido_preco_assinatura_ok(
  _id uuid, _preco numeric, _assinatura text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  -- stub da Tarefa 2: nao valida nada ainda (a Tarefa 3 coloca a conferencia real da previa).
  RETURN;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._variante_tecido_preco_assinatura_ok(uuid, numeric, text) FROM PUBLIC, anon, authenticated;

-- 2. _core: faz o trabalho; EXECUTE revogado dos 3 (o wrapper chama).
CREATE OR REPLACE FUNCTION public._salvar_variante_tecido_core(
  _id uuid, _mudancas jsonb, _base jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_var_tenant uuid;
  v_k text;
  v_atual jsonb;         -- valor atual da coluna no servidor (jsonb 'null' quando NULL)
  v_base jsonb;          -- valor que o cliente carregou
  v_novo jsonb;          -- valor que o cliente quer gravar
  v_set_cols text[] := '{}';
  v_conflito text[] := '{}';
  v_row public.variantes_tecido%ROWTYPE;
  c_permitidas constant text[] := ARRAY['cor_id', 'cor_apelido_id', 'nome_variante', 'codigo_variante', 'preco'];
BEGIN
  IF _mudancas IS NULL OR jsonb_typeof(_mudancas) <> 'object'
     OR _base IS NULL OR jsonb_typeof(_base) <> 'object' THEN
    RAISE EXCEPTION 'dados_invalidos: variante_tecido' USING ERRCODE = 'P0001';
  END IF;

  -- trava a linha e confere a loja (o artigo da variante tem de ser da loja do chamador)
  SELECT * INTO v_row FROM public.variantes_tecido WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrado: variante' USING ERRCODE = 'P0002';
  END IF;
  SELECT a.tenant_id INTO v_var_tenant FROM public.artigos a WHERE a.id = v_row.artigo_id;
  IF v_var_tenant IS DISTINCT FROM v_tenant
     OR (v_row.tenant_id IS NOT NULL AND v_row.tenant_id <> v_tenant) THEN
    RAISE EXCEPTION 'nao_encontrado: variante' USING ERRCODE = 'P0002'; -- sem oraculo cross-tenant
  END IF;

  -- valida chaves + detecta conflito por campo (CAS)
  FOR v_k IN SELECT k FROM jsonb_object_keys(_mudancas) AS j(k) LOOP
    IF NOT (v_k = ANY (c_permitidas)) THEN
      RAISE EXCEPTION 'campo_nao_editavel: %', v_k USING ERRCODE = 'P0001';
    END IF;
    IF NOT (_base ? v_k) THEN
      RAISE EXCEPTION 'base_ausente: %', v_k USING ERRCODE = 'P0001';
    END IF;

    -- valor atual da coluna como jsonb (NULL do banco = jsonb 'null', para comparar com o que o cliente manda)
    v_atual := COALESCE(
      CASE v_k
        WHEN 'cor_id' THEN to_jsonb(v_row.cor_id)
        WHEN 'cor_apelido_id' THEN to_jsonb(v_row.cor_apelido_id)
        WHEN 'nome_variante' THEN to_jsonb(v_row.nome_variante)
        WHEN 'codigo_variante' THEN to_jsonb(v_row.codigo_variante)
        WHEN 'preco' THEN to_jsonb(v_row.preco)
      END, 'null'::jsonb);
    v_base := COALESCE(_base -> v_k, 'null'::jsonb);
    v_novo := COALESCE(_mudancas -> v_k, 'null'::jsonb);
    -- texto vazio grava NULL (NULLIF do UPDATE): compara como NULL dos tres lados
    IF v_atual = '""'::jsonb THEN v_atual := 'null'::jsonb; END IF;
    IF v_base = '""'::jsonb THEN v_base := 'null'::jsonb; END IF;
    IF v_novo = '""'::jsonb THEN v_novo := 'null'::jsonb; END IF;

    IF v_atual = v_novo THEN
      NULL; -- convergencia (ou nada a mudar): nao e conflito e nao ha o que gravar
    ELSIF v_atual = v_base THEN
      v_set_cols := v_set_cols || v_k; -- ninguem mexeu desde que eu li: posso gravar
    ELSE
      v_conflito := v_conflito || v_k; -- mudou no servidor E difere do que eu gravaria
    END IF;
  END LOOP;

  IF array_length(v_conflito, 1) > 0 THEN
    RAISE EXCEPTION 'conflito_versao: variante_tecido'
      USING ERRCODE = 'P0409', DETAIL = array_to_string(v_conflito, ',');
  END IF;

  -- grava so os campos liberados (UPDATE estatico por coluna conhecida; sem SQL dinamico)
  IF array_length(v_set_cols, 1) > 0 THEN
    UPDATE public.variantes_tecido SET
      cor_id = CASE WHEN 'cor_id' = ANY (v_set_cols)
                    THEN NULLIF(_mudancas ->> 'cor_id', '')::uuid ELSE cor_id END,
      cor_apelido_id = CASE WHEN 'cor_apelido_id' = ANY (v_set_cols)
                            THEN NULLIF(_mudancas ->> 'cor_apelido_id', '')::uuid ELSE cor_apelido_id END,
      nome_variante = CASE WHEN 'nome_variante' = ANY (v_set_cols)
                           THEN NULLIF(_mudancas ->> 'nome_variante', '') ELSE nome_variante END,
      codigo_variante = CASE WHEN 'codigo_variante' = ANY (v_set_cols)
                             THEN NULLIF(_mudancas ->> 'codigo_variante', '') ELSE codigo_variante END,
      preco = CASE WHEN 'preco' = ANY (v_set_cols)
                   THEN NULLIF(_mudancas ->> 'preco', '')::numeric ELSE preco END
    WHERE id = _id;
  END IF;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._salvar_variante_tecido_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- 3. wrapper: login + loja + modulo cadastro (D2 A: Cadastro NAO e trancado por pagina); valida a assinatura da previa se o preco mudou.
CREATE OR REPLACE FUNCTION public.salvar_variante_tecido(
  _id uuid, _mudancas jsonb, _base jsonb, _assinatura text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faca login para salvar.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL OR v_tenant = c_nil OR NOT public.meu_tenant_ativo() THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja - operacao nao permitida.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('cadastro'); -- portao de MODULO (nao de pagina)
  -- Valida a assinatura da previa QUANDO o preco mudou (a Tarefa 3 define o retrato). A assinatura depende do
  -- PRECO NOVO, entao passa-se o preco de _mudancas (jsonb null ou '' vira NULL numerico).
  IF jsonb_typeof(_mudancas) = 'object' AND _mudancas ? 'preco' THEN
    PERFORM public._variante_tecido_preco_assinatura_ok(
      _id,
      NULLIF(_mudancas ->> 'preco', '')::numeric,
      _assinatura);
  END IF;
  PERFORM public._salvar_variante_tecido_core(_id, _mudancas, _base);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.salvar_variante_tecido(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_variante_tecido(uuid, jsonb, jsonb, text) TO authenticated, service_role;

-- pos-condicao: ACL conferida (o _core e o helper nao podem ser executados por PUBLIC/anon/authenticated)
DO $pos$
BEGIN
  IF has_function_privilege('anon', 'public._salvar_variante_tecido_core(uuid,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._salvar_variante_tecido_core(uuid,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._variante_tecido_preco_assinatura_ok(uuid,numeric,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._variante_tecido_preco_assinatura_ok(uuid,numeric,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.salvar_variante_tecido(uuid,jsonb,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.salvar_variante_tecido(uuid,jsonb,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'camada_salvar_variante_tecido: ACL inesperada' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
