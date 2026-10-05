-- Frente Backend F2.1 (desenho itens 4a/4c): RPC de LEITURA nova public.opcoes_colecao_modelos() - as opcoes dos filtros de
-- Colecao/Subcolecao (PCP > Etapas, Dashboard > Comercial) calculadas no servidor, sem trazer os cards para a tela (o select sem
-- .range do PCP > Etapas corta em 1000 linhas sem avisar; o Comercial pagina TODOS os cards so para montar as opcoes).
-- Escrito a mao (objeto NOVO; nenhuma funcao existente e redefinida). Plano: .superpowers/sdd/2026-10-05-backend/plan.md
-- (§0 K6/K9, §6 F2.1, §13).
-- Devolve jsonb {"colecoes": [text...], "subcolecoes": [text...]} (distintos, sem vazio; a ORDEM final e da tela - .sort()).
--   colecoes    = rotulo da colecao de cada card da loja: MESMA regra de public._modelo_colecao_rotulo (Modularidade T3) e de
--                 rotuloColecao (TS, src/lib/colecao-rotulo.ts): nome da colecao do OTB (colecao_id, da MESMA loja), senao o texto
--                 livre modelos.colecao com trim; vazio = fora. A regra e copiada (nao chama o helper por linha: DEFINER + SET nao
--                 inlina); anti-drift de texto e de dados em tests/integration/bk-f2-opcoes-colecao.test.ts. A guarda fixa o md5 do
--                 helper: se a regra mudar la, esta ida recusa (gerar de novo junto).
--   subcolecoes = modelos.subcolecao distintos, sem NULL e sem '' (= o .filter(Boolean) da tela de hoje).
-- Seguranca: SECURITY DEFINER + SET search_path TO 'public' (GC 10). A loja e SEMPRE a ativa do usuario
-- (public.get_user_tenant_id(): loja inativa de nao-super = sentinela = listas vazias; sem JWT / service_role = sentinela =
-- vazio). Expoe so o que a RLS de SELECT de modelos/colecoes (tenant_id = get_user_tenant_id(), sem RESTRICTIVE de modulo) ja
-- deixa o usuario ler pelo PostgREST: sem portao de modulo nem de pagina (leitura - decisao T4 da Modularidade; as telas que
-- chamam ja sao portadas no front, e o dado e o mesmo que o select direto devolve).
-- EXECUTE: revogado de PUBLIC e anon; authenticated (a tela chama) e service_role.
-- ============================== GUARDA ==============================
--   funcao ja existe: tem de ser = IDA (md5 abaixo) - senao P0001 bk_f21_diferente (outra frente mexeu);
--   outra sobrecarga public.opcoes_colecao_modelos(<args>) -> P0001 bk_f21_sobrecarga (ambiguidade no PostgREST);
--   dependencias: public._modelo_colecao_rotulo(uuid,uuid,text) md5 = e9220bc3a67b82ddcd768b8ad5a81a46 (IDA da Mod T3 - a regra
--   copiada aqui); public.get_user_tenant_id() existe, SECURITY DEFINER, devolve uuid. Senao P0001 bk_f21_dep.
-- ====================================================================
-- Trava: so catalogo (CREATE FUNCTION + GRANT/REVOKE; a validacao do corpo SQL pega AccessShare em modelos/colecoes por um
-- instante). Nada em auth/storage/realtime; nenhuma policy/gatilho/tabela. Em ate 1500ms (lock_timeout); 55P03/40P01 = nada
-- mudou, rodar de novo. Idempotente (reaplicar = mesmo texto, mesmo md5, mesmos grants).
-- Volta: supabase/rollback/20261103145000_bk_opcoes_colecao_down.sql (no-op documentado: a RPC fica, inerte - o site velho nao a
-- chama); remover = supabase/rollback/20261103145000_bk_opcoes_colecao_down_drop.sql (opcional, depois, LIFO, com o SITE ja
-- voltado - o site novo chama a RPC).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_ida constant text := 'e81c8269e75912056e885700d30e3e18';
  v_rot constant text := 'e9220bc3a67b82ddcd768b8ad5a81a46';
  v_md5 text;
  v_n int;
BEGIN
  SELECT md5(pg_get_functiondef(to_regprocedure('public.opcoes_colecao_modelos()'))) INTO v_md5;
  IF v_md5 IS NOT NULL AND v_md5 <> v_ida THEN
    RAISE EXCEPTION 'bk_f21_diferente: opcoes_colecao_modelos() existe com outro texto (md5 %) - outra frente mexeu', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'opcoes_colecao_modelos' AND p.pronargs > 0;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'bk_f21_sobrecarga: % sobrecarga(s) de public.opcoes_colecao_modelos com argumentos', v_n
      USING ERRCODE = 'P0001';
  END IF;
  SELECT md5(pg_get_functiondef(to_regprocedure('public._modelo_colecao_rotulo(uuid,uuid,text)'))) INTO v_md5;
  IF v_md5 IS DISTINCT FROM v_rot THEN
    RAISE EXCEPTION 'bk_f21_dep: _modelo_colecao_rotulo md5 % (esperado %) - a regra do rotulo mudou; gerar esta RPC de novo',
      coalesce(v_md5, 'ausente'), v_rot USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.get_user_tenant_id()')
                  AND p.prosecdef AND p.prorettype = 'uuid'::regtype) THEN
    RAISE EXCEPTION 'bk_f21_dep: get_user_tenant_id() ausente ou diferente (DEFINER, uuid)' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.opcoes_colecao_modelos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [backend F2] opcoes dos filtros de Colecao/Subcolecao (PCP > Etapas, Dashboard > Comercial) sem trazer os cards (teto de
  -- 1000 linhas do PostgREST). Colecao = MESMA regra do helper de rotulo da colecao da Mod T3 (anti-drift de texto e de dados
  -- em bk-f2-opcoes-colecao.test.ts). NAO citar o nome do helper aqui: o _down_drop da Mod T3 varre o prosrc (com comentarios).
  -- Loja = a ativa do usuario (get_user_tenant_id: loja inativa = sentinela = vazio). Leitura: sem portao de modulo (decisao T4).
  WITH r AS (
    SELECT coalesce((SELECT c.nome::text FROM public.colecoes c WHERE c.id = m.colecao_id AND c.tenant_id = m.tenant_id),
                    nullif(btrim(coalesce(m.colecao, '')), '')) AS col,
           nullif(m.subcolecao, '') AS sub
      FROM public.modelos m
     WHERE m.tenant_id = public.get_user_tenant_id()
  )
  SELECT jsonb_build_object(
    'colecoes',    coalesce((SELECT jsonb_agg(DISTINCT col) FROM r WHERE col IS NOT NULL AND col <> ''), '[]'::jsonb),
    'subcolecoes', coalesce((SELECT jsonb_agg(DISTINCT sub) FROM r WHERE sub IS NOT NULL), '[]'::jsonb));
$function$;

REVOKE EXECUTE ON FUNCTION public.opcoes_colecao_modelos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opcoes_colecao_modelos() TO authenticated, service_role;

DO $pos$
DECLARE
  v_ida constant text := 'e81c8269e75912056e885700d30e3e18';
  v_oid oid := to_regprocedure('public.opcoes_colecao_modelos()');
  v_p record;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'bk_f21_pos: funcao ausente' USING ERRCODE = 'P0001';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) AS md5, p.prosecdef, p.proconfig, p.provolatile, p.prorettype INTO v_p
    FROM pg_proc p WHERE p.oid = v_oid;
  IF v_p.md5 <> v_ida OR NOT v_p.prosecdef OR v_p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
     OR v_p.provolatile <> 's' OR v_p.prorettype <> 'jsonb'::regtype THEN
    RAISE EXCEPTION 'bk_f21_pos: md5 % secdef % config % volatil % (esperado IDA, t, {search_path=public}, s)',
      v_p.md5, v_p.prosecdef, v_p.proconfig, v_p.provolatile USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = v_oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'bk_f21_pos: grants errados (%)', (SELECT proacl::text FROM pg_proc WHERE oid = v_oid)
      USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
