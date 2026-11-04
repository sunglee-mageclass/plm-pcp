-- Camada intermediaria / "Salvar por card" do Plan. Tecido — Tarefas 2 e 3 (banco).
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
--   * Tarefa 3 (mesma migration, ruling de pre-flight T2<->T3): PREVIA DE PRECO no servidor.
--       - `variante_tecido_preco_previa(_id, _preco)` (wrapper STABLE: login + loja + modulo `cadastro`) -> `{afetados, assinatura}`:
--         `afetados` = quantos cards INTERNOS e NAO cortados teriam o custo previsto recalculado se o preco da cor virasse `_preco`
--         (mesmos caminhos e mesma regra da fila do custo: linha do Tecido, variante substituta, vinculo de OC; card ja enviado ao
--         corte fica de fora — congelado, R-CD1); `assinatura` = md5(id + preco normalizado + ids afetados ordenados). SO LEITURA:
--         nao grava, nao enfileira, nao recalcula (so CONTA os ids).
--       - `_variante_tecido_preco_assinatura_ok(_id, _preco, _assinatura)` (o stub da Tarefa 2 virou a conferencia real): recomputa
--         o retrato com o preco que esta sendo gravado e, se a assinatura nao bate (ou veio NULL com preco presente),
--         P0409 `previa_desatualizada: salvar_preco` (ASCII) — a tela repede a previa.
--       - SEM ORACULO cross-tenant: a conferencia da assinatura so responde diferente para variante DA LOJA do chamador. Variante
--         de outra loja, de `tenant_id` divergente e id inexistente recebem, ANTES de qualquer conferencia, o MESMO
--         `nao_encontrado: variante` (P0002) do `_core`, com qualquer assinatura; e a propria previa devolve para esses casos a
--         resposta "nada afetado" com o retrato de so id + preco (nada da loja alheia entra na conta).
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

-- 1. PREVIA (so leitura). O `_core` recebe o preco por parametro e a loja vem do JWT (nunca de parametro).
CREATE OR REPLACE FUNCTION public._variante_tecido_preco_previa_core(_id uuid, _preco numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_art uuid;
  v_ids uuid[];
BEGIN
  -- variante e artigo TEM de ser da loja do chamador (mesmo criterio do _core do salvar). Variante de outra loja, de
  -- tenant_id divergente e id inexistente caem no MESMO ramo: nenhum card e lido, nenhum id entra no retrato.
  SELECT vt.artigo_id INTO v_art
    FROM public.variantes_tecido vt
    JOIN public.artigos a ON a.id = vt.artigo_id AND a.tenant_id = v_tenant
   WHERE vt.id = _id
     AND (vt.tenant_id IS NULL OR vt.tenant_id = v_tenant);

  IF v_art IS NOT NULL THEN
    -- Cards INTERNOS, da loja, NAO cortados, que usam o artigo da cor: os mesmos 3 caminhos e o mesmo filtro com que a fila do
    -- custo enfileira quando o preco do artigo muda (linha do Tecido; variante substituta de qualquer cor do artigo; vinculo
    -- de OC). Card ja enviado ao corte fica congelado (R-CD1). Cada card conta UMA vez.
    SELECT array_agg(DISTINCT m.id ORDER BY m.id) INTO v_ids
      FROM (
        SELECT mt.modelo_id
          FROM public.modelo_tecidos mt
         WHERE mt.artigo_id = v_art
        UNION
        SELECT mt.modelo_id
          FROM public.variantes_tecido vt
          JOIN public.modelo_tecido_variantes mtv ON mtv.variante_tecido_id = vt.id
          JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
         WHERE vt.artigo_id = v_art
        UNION
        SELECT l.modelo_id
          FROM public.variantes_tecido vt
          JOIN public.modelo_tecido_oc_links l ON l.variante_tecido_id = vt.id
         WHERE vt.artigo_id = v_art
      ) u
      JOIN public.modelos m ON m.id = u.modelo_id
     WHERE m.tenant_id = v_tenant
       AND m.origem = 'interno'
       AND NOT EXISTS (SELECT 1 FROM public.cad c WHERE c.modelo_id = m.id AND c.enviado_corte);
  END IF;
  v_ids := COALESCE(v_ids, '{}'::uuid[]);

  -- retrato canonico: id + preco (trim_scale: 20, 20.0 e 20.00 sao o MESMO preco) + ids afetados em ordem
  RETURN jsonb_build_object(
    'afetados', COALESCE(array_length(v_ids, 1), 0),
    'assinatura', md5(
      COALESCE(_id::text, '') || ':' || COALESCE(trim_scale(_preco)::text, '') || ':' || array_to_string(v_ids, ',')
    )
  );
END
$function$;

REVOKE EXECUTE ON FUNCTION public._variante_tecido_preco_previa_core(uuid, numeric) FROM PUBLIC, anon, authenticated;

-- 2. wrapper da previa: login + loja + modulo `cadastro` (mesmo portao do salvar; leitura nao ganha portao de pagina)
CREATE OR REPLACE FUNCTION public.variante_tecido_preco_previa(_id uuid, _preco numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Faca login para ver a previa.' USING ERRCODE = '42501';
  END IF;
  IF v_tenant IS NULL OR v_tenant = c_nil OR NOT public.meu_tenant_ativo() THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja - operacao nao permitida.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('cadastro');
  RETURN public._variante_tecido_preco_previa_core(_id, _preco);
END
$function$;

REVOKE EXECUTE ON FUNCTION public.variante_tecido_preco_previa(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.variante_tecido_preco_previa(uuid, numeric) TO authenticated, service_role;

-- 3. conferencia da assinatura no Salvar (substitui o stub da Tarefa 2). Ordenada ANTES do wrapper do salvar.
CREATE OR REPLACE FUNCTION public._variante_tecido_preco_assinatura_ok(
  _id uuid, _preco numeric, _assinatura text
) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v jsonb;
BEGIN
  -- SEM ORACULO: a variante tem de ser da loja do chamador ANTES de qualquer resposta que dependa da assinatura. Variante de
  -- outra loja, de tenant_id divergente e id inexistente dao o MESMO erro do _core do salvar (P0002 nao_encontrado: variante),
  -- com assinatura certa, errada ou NULL; so quem e dono da variante chega a ouvir `previa_desatualizada`. (A previa, por
  -- construcao, ja devolve o retrato vazio e identico para esses tres casos; esta checagem explicita impede que o Salvar
  -- vire um canal que distingue "existe em outra loja" de "nao existe".)
  IF NOT EXISTS (
    SELECT 1
      FROM public.variantes_tecido vt
      JOIN public.artigos a ON a.id = vt.artigo_id AND a.tenant_id = v_tenant
     WHERE vt.id = _id
       AND (vt.tenant_id IS NULL OR vt.tenant_id = v_tenant)
  ) THEN
    RAISE EXCEPTION 'nao_encontrado: variante' USING ERRCODE = 'P0002';
  END IF;

  -- preco presente sem assinatura: a tela SEMPRE manda a da previa quando mexe no preco
  IF _assinatura IS NULL THEN
    RAISE EXCEPTION 'previa_desatualizada: salvar_preco' USING ERRCODE = 'P0409';
  END IF;

  -- recomputa o retrato com o preco que esta sendo gravado: se a lista de cards afetados mudou desde a previa (card novo
  -- usando a cor, afetado que foi cortado) ou o preco e outro, o md5 difere
  v := public._variante_tecido_preco_previa_core(_id, _preco);
  IF (v ->> 'assinatura') IS DISTINCT FROM _assinatura THEN
    RAISE EXCEPTION 'previa_desatualizada: salvar_preco' USING ERRCODE = 'P0409';
  END IF;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._variante_tecido_preco_assinatura_ok(uuid, numeric, text) FROM PUBLIC, anon, authenticated;

-- 4. _core: faz o trabalho; EXECUTE revogado dos 3 (o wrapper chama).
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

-- 5. wrapper: login + loja + modulo cadastro (D2 A: Cadastro NAO e trancado por pagina); valida a assinatura da previa se o preco mudou.
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
  -- Valida a assinatura da previa QUANDO o preco mudou. A assinatura depende do PRECO NOVO, entao passa-se o preco de
  -- _mudancas (jsonb null ou '' vira NULL numerico). Vem ANTES do _core, mas a conferencia da assinatura recusa primeiro a
  -- variante que nao e da loja (mesmo erro do _core), entao a ordem nao cria oraculo.
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

-- pos-condicao: ACL conferida (os _core e o helper nao podem ser executados por PUBLIC/anon/authenticated)
DO $pos$
BEGIN
  IF has_function_privilege('anon', 'public._salvar_variante_tecido_core(uuid,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._salvar_variante_tecido_core(uuid,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._variante_tecido_preco_assinatura_ok(uuid,numeric,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._variante_tecido_preco_assinatura_ok(uuid,numeric,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._variante_tecido_preco_previa_core(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._variante_tecido_preco_previa_core(uuid,numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.salvar_variante_tecido(uuid,jsonb,jsonb,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.variante_tecido_preco_previa(uuid,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.salvar_variante_tecido(uuid,jsonb,jsonb,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.variante_tecido_preco_previa(uuid,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'camada_salvar_variante_tecido: ACL inesperada' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
