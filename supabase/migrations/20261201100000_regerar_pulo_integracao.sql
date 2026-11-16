-- Botoes Regerar REF / Regerar SKUs - migration 1 de 3: helper COMPARTILHADO de "pular" (fonte unica para a Parte A e a Parte B).
-- _regerar_pulo_integracao(_modelo_id) -> NULL = pode regerar; 'integracao' = integracao_produtos.estado IN ('integravel','integrado')
-- (o SKU trava SEMPRE nesse estado, marcado ou nao - fn_integracao_trava_skus); 'ja_exportado' = rastro de exportacao que sobra mesmo depois
-- de "Desfazer": integracao_produtos.integrado_em/desfeito_em nao nulos, OU integracao_log com acao 'integrado'/'desfazer' do modelo, OU
-- qualquer linha em integracao_linhas do modelo. So funcao nova (CREATE OR REPLACE + REVOKE); nenhum dado, nenhuma tabela, nenhum gatilho.
-- Idempotente. Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261201100000_regerar_pulo_integracao.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Banco ANTES do site. Volta: supabase/rollback/20261201100000_regerar_pulo_integracao_down.sql
-- ============================== MD5 DEPOIS (guarda do _down) ==============================
--   public._regerar_pulo_integracao(uuid)  9449a83d205a6117d2dedc2c637ac0b0
-- ===========================================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
BEGIN
  IF to_regclass('public.integracao_produtos') IS NULL OR to_regclass('public.integracao_log') IS NULL
     OR to_regclass('public.integracao_linhas') IS NULL THEN
    RAISE EXCEPTION 'regerar_pulo: tabelas da Integracao ausentes - aplique a Integracao antes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._regerar_pulo_integracao(_modelo_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.integracao_produtos ip
                  WHERE ip.modelo_id = _modelo_id AND ip.estado IN ('integravel', 'integrado')) THEN 'integracao'
    WHEN EXISTS (SELECT 1 FROM public.integracao_produtos ip
                  WHERE ip.modelo_id = _modelo_id AND (ip.integrado_em IS NOT NULL OR ip.desfeito_em IS NOT NULL))
      OR EXISTS (SELECT 1 FROM public.integracao_log l
                  WHERE l.modelo_id = _modelo_id AND l.acao IN ('integrado', 'desfazer'))
      OR EXISTS (SELECT 1 FROM public.integracao_linhas il WHERE il.modelo_id = _modelo_id) THEN 'ja_exportado'
    ELSE NULL
  END
$function$;
REVOKE EXECUTE ON FUNCTION public._regerar_pulo_integracao(uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.pronamespace = 'public'::regnamespace AND p.proname = '_regerar_pulo_integracao'
                AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))
                AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'regerar_pulo: pos-condicao falhou - ACL com EXECUTE para PUBLIC/anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
