-- Contas certas D5a - P-168 A (dono, 30/set): RPC NOVA, SO LEITURA, plan_tecido_vinculos_detalhe(_colecao_id uuid) +
-- _plan_tecido_vinculos_detalhe_core(_tenant uuid, _colecao_id uuid). Devolve UMA linha por vinculo card x item de OC
-- (modelo_tecido_oc_links) com prioridade e quantidade_m, para o Plan. Tecido repartir a demanda da vaga entre as OCs
-- vinculadas na mesma ordem do corte (ORDER BY prioridade, oc_tecido_item_id). Consumidor: PlanTecidoSheet.tsx (D5b),
-- tipo VinculoDetalhe em src/lib/plan-tecido/calc.ts (colunas modelo_id, tipo, numero, ordem, variante_tecido_id,
-- oc_tecido_item_id, oc_tecido_id, artigo_id, prioridade, quantidade_m).
--   * _core: STABLE SECURITY DEFINER; loja amarrada no vinculo (l.tenant_id), no modelo (m.tenant_id + m.colecao_id) e na
--     OC (oc.tenant_id); linhas em ordem deterministica; REVOKE de PUBLIC, anon e authenticated (invariante #9).
--   * wrapper: mesmo portao do plan_tecido_vinculos_modelo (tenant_module_enabled('criacao') desligado -> vazio;
--     loja = get_user_tenant_id()); REVOKE de PUBLIC e anon + GRANT authenticated.
--   * A RPC antiga plan_tecido_vinculos_modelo fica como esta (ModelCard/ModoPlanoView continuam nela).
-- Guarda de deriva: _plan_tecido_vinculos_modelo_core (o padrao espelhado) = md5 da copia 64acf81f...
--   CONFIRMADO pela Rodada #1 do Passo 0-CD (producao 30/set 15:42, 64acf81f = copia). Funcoes novas: so aceita "nao existe" ou o texto deste arquivo
--   (core 203e9d403a8f68055bf9c087ef5590b3, wrapper 7ff16cd3559e8fb88b4b680643a1cbe5) -> reaplicar e um no-op.
-- Travas: so CREATE FUNCTION + GRANT/REVOKE (nenhuma trava em tabela; nada em auth/storage; sem DROP TRIGGER/POLICY).
-- Volta: supabase/rollback/20261019400000_plan_tecido_vinculos_detalhe_down.sql (DROP FUNCTION das 2). O front que chama a
-- RPC (D5b) tolera a ausencia (erro -> lista vazia -> reparticao na ordem do array, sem limite quantidade_m).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public._plan_tecido_vinculos_modelo_core(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_d5a: _plan_tecido_vinculos_modelo_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  -- CONFIRMADO: producao = copia (Passo 0-CD Rodada #1, 30/set 15:42).
  IF md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_vinculos_modelo_core(uuid,uuid)'))) IS DISTINCT FROM '64acf81ffea335ce1fae9a6b3e910a3d' THEN
    RAISE EXCEPTION 'contas_certas_d5a: _plan_tecido_vinculos_modelo_core mudou desde o planejamento - o padrao espelhado pode ter mudado'
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.tenant_module_enabled(text)') IS NULL OR to_regprocedure('public.get_user_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'contas_certas_d5a: tenant_module_enabled/get_user_tenant_id nao existem' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelo_tecido_oc_links'
                 AND column_name = 'prioridade')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'modelo_tecido_oc_links'
                 AND column_name = 'quantidade_m') THEN
    RAISE EXCEPTION 'contas_certas_d5a: modelo_tecido_oc_links sem prioridade/quantidade_m' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_vinculos_detalhe_core(uuid,uuid)') IS NOT NULL THEN
    IF md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_vinculos_detalhe_core(uuid,uuid)'))) IS DISTINCT FROM '203e9d403a8f68055bf9c087ef5590b3' THEN
      RAISE EXCEPTION 'contas_certas_d5a: _plan_tecido_vinculos_detalhe_core existe com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF to_regprocedure('public.plan_tecido_vinculos_detalhe(uuid)') IS NOT NULL THEN
    IF md5(pg_get_functiondef(to_regprocedure('public.plan_tecido_vinculos_detalhe(uuid)'))) IS DISTINCT FROM '7ff16cd3559e8fb88b4b680643a1cbe5' THEN
      RAISE EXCEPTION 'contas_certas_d5a: plan_tecido_vinculos_detalhe existe com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
               AND proname IN ('plan_tecido_vinculos_detalhe', '_plan_tecido_vinculos_detalhe_core')
               AND oid NOT IN (SELECT x FROM (VALUES (to_regprocedure('public.plan_tecido_vinculos_detalhe(uuid)')),
                                                     (to_regprocedure('public._plan_tecido_vinculos_detalhe_core(uuid,uuid)'))) v(x)
                                WHERE x IS NOT NULL)) THEN
    RAISE EXCEPTION 'contas_certas_d5a: ja existe sobrecarga com outra assinatura' USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public._plan_tecido_vinculos_detalhe_core(_tenant uuid, _colecao_id uuid)
 RETURNS TABLE(modelo_id uuid, tipo text, numero integer, ordem integer, variante_tecido_id uuid, oc_tecido_item_id uuid,
               oc_tecido_id uuid, artigo_id uuid, prioridade integer, quantidade_m numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [contas-certas D5a / P-168 A] Vinculos card x OC COM prioridade e quantidade_m (so leitura), para o Plan. Tecido
  -- repartir a demanda entre as OCs vinculadas na mesma ordem do corte (_baixar_estoque_tecido_corte_core:
  -- ORDER BY prioridade, oc_tecido_item_id). Loja amarrada em 3 pontos: vinculo, modelo e OC. Uma linha por vinculo.
  SELECT l.modelo_id, l.tipo::text, l.numero, l.ordem, l.variante_tecido_id, l.oc_tecido_item_id,
         oc.id AS oc_tecido_id, it.artigo_id, l.prioridade, l.quantidade_m
    FROM public.modelo_tecido_oc_links l
    JOIN public.modelos m ON m.id = l.modelo_id AND m.tenant_id = _tenant AND m.colecao_id = _colecao_id
    JOIN public.ocs_tecido_itens it ON it.id = l.oc_tecido_item_id
    JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id AND oc.tenant_id = _tenant
   WHERE l.tenant_id = _tenant
   ORDER BY l.modelo_id, l.tipo, l.numero, l.ordem, l.variante_tecido_id, l.prioridade, l.oc_tecido_item_id, l.id
$function$;

CREATE OR REPLACE FUNCTION public.plan_tecido_vinculos_detalhe(_colecao_id uuid)
 RETURNS TABLE(modelo_id uuid, tipo text, numero integer, ordem integer, variante_tecido_id uuid, oc_tecido_item_id uuid,
               oc_tecido_id uuid, artigo_id uuid, prioridade integer, quantidade_m numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas D5a] Wrapper do _plan_tecido_vinculos_detalhe_core: mesmo portao do plan_tecido_vinculos_modelo
-- (modulo criacao desligado -> vazio; loja = get_user_tenant_id()). So leitura.
BEGIN
  IF NOT public.tenant_module_enabled('criacao') THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public._plan_tecido_vinculos_detalhe_core(public.get_user_tenant_id(), _colecao_id);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._plan_tecido_vinculos_detalhe_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_tecido_vinculos_detalhe(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_tecido_vinculos_detalhe(uuid) TO authenticated;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public._plan_tecido_vinculos_detalhe_core(uuid,uuid)'::regprocedure)) IS DISTINCT FROM '203e9d403a8f68055bf9c087ef5590b3'
     OR md5(pg_get_functiondef('public.plan_tecido_vinculos_detalhe(uuid)'::regprocedure)) IS DISTINCT FROM '7ff16cd3559e8fb88b4b680643a1cbe5' THEN
    RAISE EXCEPTION 'contas_certas_d5a: pos-condicao falhou (texto)' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public._plan_tecido_vinculos_detalhe_core(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public._plan_tecido_vinculos_detalhe_core(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public._plan_tecido_vinculos_detalhe_core(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_d5a: ACL errada no _core (PUBLIC/anon/authenticated nao podem)' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', 'public.plan_tecido_vinculos_detalhe(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.plan_tecido_vinculos_detalhe(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.plan_tecido_vinculos_detalhe(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_d5a: ACL errada no wrapper (PUBLIC/anon nao podem; authenticated pode)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
