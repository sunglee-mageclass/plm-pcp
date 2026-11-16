-- Volta da migration 20261201130000 (Exportar dados: permissao propria `exportar_dados`). LIFO: gatilhos e funcoes de "so super admin
-- concede" -> wrappers de volta ao portao da Integracao -> portao novo. Idempotente (IF EXISTS; guarda aceita ANTES ou DEPOIS).
-- O que NAO volta sozinho: linhas `exportar_dados` ja gravadas em user_permissions (ficam inertes: nada mais as le; apague-as a mao se quiser).
-- Ordem: volte o SITE ANTES, o banco depois (com o portao de volta na Integracao, o site novo falharia para quem so tem `exportar_dados`).
-- Aplicar FORA de transacao: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f supabase/rollback/20261201130000_exportar_dados_permissao_down.sql
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef('public.exportar_produtos(text,text,text[],text[],integer)'::regprocedure));
  IF v NOT IN ('1fa3443f73c47729224efb78c4adb1ae', 'c3bbc11117ac9366dc11923d1f79e390') THEN
    RAISE EXCEPTION 'exportar_dados_permissao_down: exportar_produtos com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.exportar_subcolecoes(text)'::regprocedure));
  IF v NOT IN ('b3559f1ab77995640ee278eb4bd8cf1a', 'd45677cb21a5ee47b01b3b82065e193a') THEN
    RAISE EXCEPTION 'exportar_dados_permissao_down: exportar_subcolecoes com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_exportar_dados_perm_papel ON public.papel_permissoes;
DROP TRIGGER IF EXISTS trg_exportar_dados_perm_user ON public.user_permissions;
DROP FUNCTION IF EXISTS public.fn_exportar_dados_perm_papel();
DROP FUNCTION IF EXISTS public.fn_exportar_dados_perm_user();

-- Os 2 wrappers: texto de ANTES (corpo vivo de 20261122100000), so a linha do portao volta a _integracao_exige(false).
CREATE OR REPLACE FUNCTION public.exportar_produtos(_colecao text, _subcolecao text, _campos text[], _niveis text[], _limite integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);  -- login + loja ativa + permissao de VER a Integracao
BEGIN
  RETURN public._exportar_produtos_core(v_tenant, _colecao, _subcolecao, _campos, _niveis, _limite);
END
$function$;

CREATE OR REPLACE FUNCTION public.exportar_subcolecoes(_colecao text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);  -- mesmo portao da exportacao
  v_col text := nullif(btrim(coalesce(_colecao, '')), '');
BEGIN
  -- subcolecoes DISTINTAS dos modelos da loja que pertencem a colecao pedida (mesmo casamento do recorte da exportacao)
  RETURN coalesce((
    SELECT jsonb_agg(DISTINCT m.subcolecao ORDER BY m.subcolecao)
      FROM public.modelos m
      LEFT JOIN public.colecoes co ON co.id = m.colecao_id AND co.tenant_id = m.tenant_id
     WHERE m.tenant_id = v_tenant
       AND nullif(btrim(coalesce(m.subcolecao, '')), '') IS NOT NULL
       AND (v_col IS NULL
            OR coalesce(co.nome::text, nullif(btrim(coalesce(m.colecao::text, '')), '')) = v_col
            OR m.colecao_id::text = lower(v_col))), '[]'::jsonb);
END
$function$;

DROP FUNCTION IF EXISTS public._exportar_exige();
DROP FUNCTION IF EXISTS public._exportar_pode();

DO $pos$
BEGIN
  IF md5(pg_get_functiondef('public.exportar_produtos(text,text,text[],text[],integer)'::regprocedure)) <> '1fa3443f73c47729224efb78c4adb1ae'
     OR md5(pg_get_functiondef('public.exportar_subcolecoes(text)'::regprocedure)) <> 'b3559f1ab77995640ee278eb4bd8cf1a' THEN
    RAISE EXCEPTION 'exportar_dados_permissao_down: os 2 wrappers nao voltaram ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._exportar_pode()') IS NOT NULL OR to_regprocedure('public._exportar_exige()') IS NOT NULL
     OR to_regprocedure('public.fn_exportar_dados_perm_user()') IS NOT NULL OR to_regprocedure('public.fn_exportar_dados_perm_papel()') IS NOT NULL THEN
    RAISE EXCEPTION 'exportar_dados_permissao_down: sobrou funcao do portao/gatilhos' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
