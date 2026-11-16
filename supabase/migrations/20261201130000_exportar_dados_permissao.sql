-- Exportar dados vira item proprio na sidebar - BANCO: permissao PROPRIA `exportar_dados` (so super admin concede).
-- Plano: docs/superpowers/plans/2026-11-16-exportar-dados-sidebar.md (Tasks 1 e 2, MESMA migration).
-- Spec:  docs/superpowers/specs/2026-11-16-exportar-dados-sidebar-design.md (secao Banco).
--   1. Portao NOVO (espelho de _integracao_pode/_integracao_exige, key `exportar_dados`, SEM bypass de tenant_admin):
--        _exportar_pode()   = is_super_admin() OR a linha `exportar_dados` (pode_ver) em _perm_efetiva(auth.uid()).
--        _exportar_exige()  = login (42501) + loja ativa (42501) + _exportar_pode() (42501); devolve o tenant.
--      As 2 funcoes: SECURITY DEFINER, REVOKE dos 3 (PUBLIC/anon/authenticated) - so os wrappers (DEFINER) as chamam.
--   2. Os 2 wrappers (exportar_produtos, exportar_subcolecoes) so trocam a linha do portao:
--        public._integracao_exige(false)  ->  public._exportar_exige()          (ACL dos wrappers preservada pelo REPLACE)
--      _exportar_produtos_core INTOCADO (a migration RECUSA se o texto dele divergir).
--   3. Quem concede `exportar_dados` e SO o super admin (espelho de fn_integracao_perm_user / fn_integracao_perm_papel, que tem a
--      key `integracao` hard-coded - por isso funcoes NOVAS; igualdade exata, sem LIKE: `exportar_dados` nao tem sub-keys):
--        trg_exportar_dados_perm_user (BEFORE INS/UPD/DEL em user_permissions): linha `exportar_dados` escrita por quem NAO e
--          super admin e IGNORADA em silencio (RETURN NULL) - o DELETE+INSERT do set_user_permissions de um admin da loja nao
--          apaga a permissao dada pelo super admin nem a concede. Excecao no DELETE: passa quando o usuario da linha ja nao
--          existe em public.users (cascata de excluir usuario).
--        trg_exportar_dados_perm_papel (BEFORE INS/UPD em papel_permissoes): papel NUNCA carrega `exportar_dados`.
--      + limpeza defensiva das linhas `exportar_dados` de papel_permissoes (sem backfill: a permissao COMECA VAZIA).
--      reset_loja/_wipe_tenant_core rodam com session_replication_role = replica: estes gatilhos nao disparam la.
-- RAISE do portao = 42501 (403, pode ter acento). Contagens: +4 funcoes | +2 gatilhos | 2 funcoes redefinidas (so a linha do portao).
-- Idempotente (guarda aceita o texto de antes OU o de depois; CREATE OR REPLACE). SITE: o site velho chama a RPC ja com o portao
-- novo (quem nao tem `exportar_dados` recebe 42501 na aba velha da Integracao - inofensivo; a aba some no site novo). Banco ANTES do site.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261201130000_exportar_dados_permissao.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Volta: supabase/rollback/20261201130000_exportar_dados_permissao_down.sql
-- ============================== MD5 (guarda) ==============================
--   INTOCADO (a migration RECUSA se divergir):
--     public._exportar_produtos_core(uuid,text,text,text[],text[],integer)   36501a76de5616cda4a3aa59a0d71a5a
--   REDEFINIDOS (ANTES -> DEPOIS):
--     public.exportar_produtos(text,text,text[],text[],integer)   1fa3443f73c47729224efb78c4adb1ae -> c3bbc11117ac9366dc11923d1f79e390
--     public.exportar_subcolecoes(text)                           b3559f1ab77995640ee278eb4bd8cf1a -> d45677cb21a5ee47b01b3b82065e193a
-- ==========================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

DO $guarda$
DECLARE
  v text;
BEGIN
  v := md5(pg_get_functiondef('public._exportar_produtos_core(uuid,text,text,text[],text[],integer)'::regprocedure));
  IF v <> '36501a76de5616cda4a3aa59a0d71a5a' THEN
    RAISE EXCEPTION 'exportar_dados_permissao: _exportar_produtos_core com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.exportar_produtos(text,text,text[],text[],integer)'::regprocedure));
  IF v NOT IN ('1fa3443f73c47729224efb78c4adb1ae', 'c3bbc11117ac9366dc11923d1f79e390') THEN
    RAISE EXCEPTION 'exportar_dados_permissao: exportar_produtos com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef('public.exportar_subcolecoes(text)'::regprocedure));
  IF v NOT IN ('b3559f1ab77995640ee278eb4bd8cf1a', 'd45677cb21a5ee47b01b3b82065e193a') THEN
    RAISE EXCEPTION 'exportar_dados_permissao: exportar_subcolecoes com texto inesperado (md5 %)', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- Quem pode usar a exportacao: SO o super admin ou a linha `exportar_dados` (ver) do PROPRIO usuario (o papel nunca a carrega - gatilho
-- abaixo). Espelha user_can_view SEM o atalho de admin/tenant_admin (mesma regra da Integracao: _integracao_pode).
CREATE OR REPLACE FUNCTION public._exportar_pode()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin()
      OR EXISTS (
        SELECT 1 FROM public._perm_efetiva(auth.uid()) e
         WHERE e.pagina = 'exportar_dados' AND e.pode_ver
      );
$function$;

CREATE OR REPLACE FUNCTION public._exportar_exige()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem loja — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF NOT public._exportar_pode() THEN
    RAISE EXCEPTION 'Sem permissão para exportar dados.' USING ERRCODE = '42501';
  END IF;
  RETURN v_tenant;
END
$function$;

REVOKE EXECUTE ON FUNCTION public._exportar_pode() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._exportar_exige() FROM PUBLIC, anon, authenticated;

-- Os 2 wrappers: corpo VIVO, a UNICA mudanca e a linha do portao. (CREATE OR REPLACE preserva a ACL: authenticated sim, anon nao.)
CREATE OR REPLACE FUNCTION public.exportar_produtos(_colecao text, _subcolecao text, _campos text[], _niveis text[], _limite integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._exportar_exige();  -- login + loja ativa + permissao `exportar_dados`
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
  v_tenant uuid := public._exportar_exige();  -- mesmo portao da exportacao
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

-- user_permissions: quem NAO e super admin nao concede, nao altera e nao apaga `exportar_dados` (no-op silencioso, sem RAISE).
CREATE OR REPLACE FUNCTION public.fn_exportar_dados_perm_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.pagina = 'exportar_dados' AND NOT public.is_super_admin()
       AND EXISTS (SELECT 1 FROM public.users u WHERE u.id = OLD.user_id) THEN
      RETURN NULL;
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.pagina = 'exportar_dados'
      OR (TG_OP = 'UPDATE' AND OLD.pagina = 'exportar_dados'))
     AND NOT public.is_super_admin() THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;

-- papel_permissoes: o papel NUNCA carrega `exportar_dados` (nem gravado pelo super admin).
CREATE OR REPLACE FUNCTION public.fn_exportar_dados_perm_papel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.pagina = 'exportar_dados'
     OR (TG_OP = 'UPDATE' AND OLD.pagina = 'exportar_dados') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_exportar_dados_perm_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_exportar_dados_perm_papel() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_exportar_dados_perm_user
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_permissions
  FOR EACH ROW EXECUTE FUNCTION public.fn_exportar_dados_perm_user();
CREATE OR REPLACE TRIGGER trg_exportar_dados_perm_papel
  BEFORE INSERT OR UPDATE ON public.papel_permissoes
  FOR EACH ROW EXECUTE FUNCTION public.fn_exportar_dados_perm_papel();

-- Limpeza DEPOIS do gatilho (defensiva; a permissao comeca vazia: na copia, 0 linhas).
DO $limpeza$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.papel_permissoes WHERE pagina = 'exportar_dados';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'exportar_dados_permissao: % linha(s) exportar_dados apagada(s) de papel_permissoes', n;
END
$limpeza$;

DO $pos$
DECLARE
  f text;
  n integer;
BEGIN
  IF md5(pg_get_functiondef('public.exportar_produtos(text,text,text[],text[],integer)'::regprocedure)) <> 'c3bbc11117ac9366dc11923d1f79e390'
     OR md5(pg_get_functiondef('public.exportar_subcolecoes(text)'::regprocedure)) <> 'd45677cb21a5ee47b01b3b82065e193a' THEN
    RAISE EXCEPTION 'exportar_dados_permissao: os 2 wrappers nao ficaram no texto esperado' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef('public._exportar_produtos_core(uuid,text,text,text[],text[],integer)'::regprocedure)) <> '36501a76de5616cda4a3aa59a0d71a5a' THEN
    RAISE EXCEPTION 'exportar_dados_permissao: _exportar_produtos_core mudou' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('exportar_produtos', 'exportar_subcolecoes')
     AND pg_get_functiondef(p.oid) ~ '_integracao_exige';
  IF n <> 0 THEN
    RAISE EXCEPTION 'exportar_dados_permissao: % wrapper(s) ainda usam _integracao_exige', n USING ERRCODE = 'P0001';
  END IF;
  FOREACH f IN ARRAY ARRAY['public._exportar_pode()', 'public._exportar_exige()',
    'public.fn_exportar_dados_perm_user()', 'public.fn_exportar_dados_perm_papel()'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'exportar_dados_permissao: % executavel por PUBLIC/anon/authenticated', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.exportar_produtos(text,text,text[],text[],integer)', 'public.exportar_subcolecoes(text)'] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'exportar_dados_permissao: ACL errada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM pg_trigger t
   WHERE NOT t.tgisinternal AND t.tgenabled = 'O'
     AND ((t.tgrelid = 'public.user_permissions'::regclass AND t.tgname = 'trg_exportar_dados_perm_user')
       OR (t.tgrelid = 'public.papel_permissoes'::regclass AND t.tgname = 'trg_exportar_dados_perm_papel'));
  IF n <> 2 THEN
    RAISE EXCEPTION 'exportar_dados_permissao: esperado 2 gatilhos (ENABLE padrao), achei %', n USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.papel_permissoes WHERE pagina = 'exportar_dados') THEN
    RAISE EXCEPTION 'exportar_dados_permissao: sobrou linha exportar_dados em papel_permissoes' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
