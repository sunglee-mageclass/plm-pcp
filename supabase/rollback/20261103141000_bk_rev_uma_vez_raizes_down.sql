-- Inverso de supabase/migrations/20261103141000_bk_rev_uma_vez_raizes.sql — GERADO por .superpowers/sdd/2026-10-05-backend/mig/gerar-bk2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-05-backend/plan.md (§3 B2, §0 K2/K3, §13; Rulings R1).
-- NEUTRO: devolve os 8 textos de ANTES (md5 conferido) = o bump volta a ser 1 por linha da filha. Sem DROP.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_colab_bump_cad_direto()  [raiz cad; INVOKER]
--     ANTES  11de99c5d82533a5afe4cb84a77cf1d6
--     DEPOIS fc82f52d6fea2b38407e097f25a3c7d8
--   public.fn_colab_bump_cad_via_ctv()  [raiz cad; INVOKER]
--     ANTES  c7ecad42efaf2f92967e525ae0644e0b
--     DEPOIS 0ac9004c6ada8b0002a301c0ea5cf171
--   public.fn_colab_bump_artigo_via_variante()  [raiz artigos; INVOKER]
--     ANTES  ad046ad6a45b9bf313df91775583b740
--     DEPOIS 1a8259e5f4d8f8242d72da552b44fcb3
--   public.fn_colab_bump_cq()  [raiz controle_qualidade; DEFINER]
--     ANTES  3e80093567f8e1f2040c8fccaa23f014
--     DEPOIS e4107f6bb5ae69803fc8801c7fed0ad1
--   public.fn_colab_bump_oc()  [raiz ocs_tecido; DEFINER]
--     ANTES  e5d8da33662c90594690253b10d8f611
--     DEPOIS 7ebdbca9cccf758503aaa157582ddd9c
--   public.fn_colab_bump_oc_avi()  [raiz ocs_aviamento; DEFINER]
--     ANTES  acab05e51f702c0912d0138d49a4c555
--     DEPOIS edb1d74b4d5eb3a7a47d7d77d1e333e4
--   public.fn_colab_bump_oc_etq()  [raiz ocs_etiqueta; DEFINER]
--     ANTES  cd39911e71bab5e8ce304e1365f3f6b5
--     DEPOIS 11298265cdf5470d78e0c9867be62b48
--   public.fn_colab_bump_plan()  [raiz colecoes; DEFINER]
--     ANTES  73333b358aa6e3ea5064820bb0619fb3
--     DEPOIS 128de297e8065f4f2168132d66331b69
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 8 funcoes de gatilho): nenhuma tabela (os gatilhos NAO sao recriados),
-- nada de auth/storage/realtime. Sem DROP, sem CREATE/DROP TRIGGER/POLICY, sem NOTIFY. Idempotente (a guarda aceita antes OU depois).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_cad_direto()', '11de99c5d82533a5afe4cb84a77cf1d6', 'fc82f52d6fea2b38407e097f25a3c7d8'),
      ('public.fn_colab_bump_cad_via_ctv()', 'c7ecad42efaf2f92967e525ae0644e0b', '0ac9004c6ada8b0002a301c0ea5cf171'),
      ('public.fn_colab_bump_artigo_via_variante()', 'ad046ad6a45b9bf313df91775583b740', '1a8259e5f4d8f8242d72da552b44fcb3'),
      ('public.fn_colab_bump_cq()', '3e80093567f8e1f2040c8fccaa23f014', 'e4107f6bb5ae69803fc8801c7fed0ad1'),
      ('public.fn_colab_bump_oc()', 'e5d8da33662c90594690253b10d8f611', '7ebdbca9cccf758503aaa157582ddd9c'),
      ('public.fn_colab_bump_oc_avi()', 'acab05e51f702c0912d0138d49a4c555', 'edb1d74b4d5eb3a7a47d7d77d1e333e4'),
      ('public.fn_colab_bump_oc_etq()', 'cd39911e71bab5e8ce304e1365f3f6b5', '11298265cdf5470d78e0c9867be62b48'),
      ('public.fn_colab_bump_plan()', '73333b358aa6e3ea5064820bb0619fb3', '128de297e8065f4f2168132d66331b69')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_cad_direto()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.cad SET id = id WHERE id = COALESCE(NEW.cad_id, OLD.cad_id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_cad_via_ctv()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_cad uuid;
BEGIN
  SELECT ct.cad_id INTO v_cad FROM public.cad_tecidos ct
    WHERE ct.id = COALESCE(NEW.cad_tecido_id, OLD.cad_tecido_id);
  IF v_cad IS NOT NULL THEN UPDATE public.cad SET id = id WHERE id = v_cad; END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_artigo_via_variante()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.artigos SET id = id WHERE id = COALESCE(NEW.artigo_id, OLD.artigo_id);
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_cq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := coalesce(new.controle_qualidade_id, old.controle_qualidade_id);
begin update public.controle_qualidade set id = id where id = v_id; return coalesce(new, old); end $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := coalesce(new.oc_tecido_id, old.oc_tecido_id);
begin update public.ocs_tecido set id = id where id = v_id; return coalesce(new, old); end $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc_avi()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := coalesce(new.oc_aviamento_id, old.oc_aviamento_id);
begin update public.ocs_aviamento set id = id where id = v_id; return coalesce(new, old); end
$function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_oc_etq()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := coalesce(new.oc_etiqueta_id, old.oc_etiqueta_id);
begin update public.ocs_etiqueta set id = id where id = v_id; return coalesce(new, old); end
$function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := coalesce(new.colecao_id, old.colecao_id);
begin update public.colecoes set id = id where id = v_id; return coalesce(new, old); end $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_cad_direto()', '11de99c5d82533a5afe4cb84a77cf1d6', '{postgres=X/postgres,service_role=X/postgres}', false, ''),
      ('public.fn_colab_bump_cad_via_ctv()', 'c7ecad42efaf2f92967e525ae0644e0b', '{postgres=X/postgres,service_role=X/postgres}', false, ''),
      ('public.fn_colab_bump_artigo_via_variante()', 'ad046ad6a45b9bf313df91775583b740', '{postgres=X/postgres,service_role=X/postgres}', false, ''),
      ('public.fn_colab_bump_cq()', '3e80093567f8e1f2040c8fccaa23f014', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_oc()', 'e5d8da33662c90594690253b10d8f611', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_oc_avi()', 'acab05e51f702c0912d0138d49a4c555', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_oc_etq()', 'cd39911e71bab5e8ce304e1365f3f6b5', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public'),
      ('public.fn_colab_bump_plan()', '73333b358aa6e3ea5064820bb0619fb3', '{postgres=X/postgres,service_role=X/postgres}', true, 'search_path=public')
    ) AS x(f, m, acl, sd, cfg) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef = r.sd AND coalesce(array_to_string(p.proconfig, '|'), '') = r.cfg)
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'bk2_rev_uma_vez_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
