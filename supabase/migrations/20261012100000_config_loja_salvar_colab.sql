-- Config da Loja colaborativa (P-28 A; P-122 A / P-123 A / P-124 A, 29/set) — T1 (banco).
-- RPC NOVA `salvar_config_loja(_tenant_id, _mudancas, _base, _chave_kanban_esperada)`: "compare-and-set POR COLUNA" da
-- linha da loja em `tenant_config`. Substitui (no front, T3) o upsert da linha inteira + o update do kanban em outra txn
-- (último vence, falha parcial). Precedente em produção: `integracao_salvar` (keywords: FOR UPDATE + esperado + P0409).
--   • ZERO DDL em `tenant_config` (incidente 23/set: AccessExclusive trava as policies de todas as lojas). Este arquivo só faz
--     CREATE OR REPLACE FUNCTION + REVOKE/GRANT + NOTIFY — CREATE FUNCTION não pega lock na tabela (o teste confere pg_locks).
--   • Nenhuma função existente é redefinida (o teste confere o md5 de fn_kanban_chave_protegida, fn_kanban_config,
--     fn_tenant_config_sku_normaliza, integracao_salvar, kanban_definir_automatico, salvar_loja, fn_audit).
--   • Lista branca (18 colunas da página + Nomenclaturas): timezone, modo_baixa_estoque, modo_oc_rolo, explosao_envio_status,
--     ref_exibir_status, markup_analise_faixa, leadtime, pcp_etapas, revenda_campos, ref_config, keywords, status_kanban,
--     kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_colunas, revenda_kanban_requisitos, tab_labels,
--     campos_editaveis. NUNCA toca modules/kanban_automatico/sku_config/tamanhos_sku/tamanhos_grade/etapas_acabamento/
--     confeccao_prioridade (outros escritores). O UPDATE é estático (CASE por coluna, sem SQL dinâmico) e não lista
--     sku_config/tamanhos_sku (não dispara trg_tenant_config_sku) nem kanban_automatico (a chave só muda por
--     kanban_definir_automatico).
--   • Conflito: a coluna mudou no servidor desde a `_base` do cliente E o valor atual ≠ o que o cliente quer gravar (valor
--     convergido não é conflito) → RAISE P0409 'conflito_versao: config_loja' com DETAIL = colunas separadas por vírgula;
--     NADA gravado. Chave do kanban mudou desde a tela (coluna kanban no payload) → P0409 'chave_kanban_mudou: ...'.
--     Mensagens de P0409 SÓ ASCII (PostgREST devolve 5xx; não-ASCII vira 500 "Something went wrong" e o code some).
--   • Os gatilhos de sempre seguem valendo na MESMA txn: audit_tenant_config, trg_kanban_chave_protegida e trg_kanban_config
--     (chave ligada + coluna kanban mudou → snapshot 'config' + recálculo).
-- Retorno: {gravadas: [colunas], valores: {coluna: valor pós-gatilhos}} — `valores` só das colunas gravadas.
-- ACL (inv. #9): REVOKE de PUBLIC e anon; EXECUTE só p/ authenticated (a própria RPC exige admin da loja ou super admin).
-- Idempotente (CREATE OR REPLACE + REVOKE/GRANT). Inverso: supabase/rollback/20261012100000_config_loja_salvar_colab_down.sql
-- (reverter o FRONT antes — o front novo só salva por esta RPC).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regclass('public.tenant_config') IS NULL
     OR to_regprocedure('public.get_user_tenant_id()') IS NULL
     OR to_regprocedure('public.is_tenant_admin()') IS NULL
     OR to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'config_loja_salvar_colab: tenant_config/get_user_tenant_id/is_tenant_admin/is_super_admin ausente'
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.salvar_config_loja(
  _tenant_id uuid,
  _mudancas jsonb,
  _base jsonb,
  _chave_kanban_esperada boolean DEFAULT NULL
)
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
  v_criada integer := 0;
  v_row jsonb;
  v_new jsonb;
  v_conf text[] := ARRAY[]::text[];
  v_gravadas text[];
  v_valores jsonb := '{}'::jsonb;
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
        IF v_t <> 'string' OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_v #>> '{}') THEN
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

  -- 4. Linha da loja (nasce com os defaults se não existe) + trava SÓ a linha
  INSERT INTO public.tenant_config (tenant_id) VALUES (v_tenant) ON CONFLICT (tenant_id) DO NOTHING;
  GET DIAGNOSTICS v_criada = ROW_COUNT;
  SELECT to_jsonb(tc) INTO v_row FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant FOR UPDATE;

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

  -- 6. Compare-and-set por coluna (linha recém-criada não tem o que comparar)
  IF v_criada = 0 THEN
    FOREACH v_k IN ARRAY v_gravadas LOOP
      IF coalesce(v_row -> v_k, 'null'::jsonb) IS DISTINCT FROM coalesce(_base -> v_k, 'null'::jsonb)
         AND (v_row -> v_k) IS DISTINCT FROM (v_m -> v_k) THEN
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
    keywords = CASE WHEN v_m ? 'keywords' THEN nullif(btrim(coalesce(v_m ->> 'keywords', '')), '') ELSE keywords END,
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

  -- 8. Retorno: valores pós-gatilhos SÓ das colunas gravadas
  SELECT jsonb_object_agg(k, v_new -> k) INTO v_valores FROM unnest(v_gravadas) AS u(k);
  RETURN jsonb_build_object('gravadas', to_jsonb(v_gravadas), 'valores', coalesce(v_valores, '{}'::jsonb));
END
$function$;

-- 9. ACL (inv. #9): o default ACL dá EXECUTE a PUBLIC e (no Supabase) direto a anon em função nova.
REVOKE ALL ON FUNCTION public.salvar_config_loja(uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_config_loja(uuid, jsonb, jsonb, boolean) TO authenticated;

DO $pos$
BEGIN
  IF has_function_privilege('anon', 'public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', 'EXECUTE')
     OR has_function_privilege('public', 'public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.salvar_config_loja(uuid,jsonb,jsonb,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'config_loja_salvar_colab: ACL errada (inv. 9)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
