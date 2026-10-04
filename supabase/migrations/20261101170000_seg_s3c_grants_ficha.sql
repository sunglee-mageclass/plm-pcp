-- Reforço de segurança — sub-release S3c ("Ficha técnica, CAD, M.O. e B3"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3c.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.5, §2.7 B3, §5, §6 S3c); plano: plan.md (P-231 = D2 A; P-244 = B).
-- Escrita direta do cliente na ficha (§2.5): as 12 tabelas que a tela so grava por RPC (modelo_tecidos, _tecido_variantes,
-- _tecido_oc_links, _aviamentos, _grades, _servico_mo, _prova_comentarios, cad_tecidos, _tecido_variantes, _grades,
-- _aviamentos, _etiquetas) perdem I/U/D/T; modelo_etiquetas e modelo_observacoes (a tela grava direto) perdem so TRUNCATE
-- (pularia o gatilho). anon perde I/U/D/T nas 14. SELECT fica. Escritas do servidor = SECURITY DEFINER (owner postgres).
-- Trava: GRANT/REVOKE de tabela = catálogo — medido na cópia (pg_locks em txn revertida, seg-s3c.test.ts): nenhuma
-- trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101170000_seg_s3c_grants_ficha_down.sql (LIFO: 20261101180000_down → 170000_down → 160000_down, ANTES dos inversos da S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3c-report.md, seção "Cadeia md5").
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v_acl text;
  v_cols text;
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 's3c_grants: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.modelo_etiquetas') IS NULL
     OR to_regclass('public.modelo_observacoes') IS NULL
     OR to_regclass('public.modelo_tecidos') IS NULL
     OR to_regclass('public.modelo_tecido_variantes') IS NULL
     OR to_regclass('public.modelo_tecido_oc_links') IS NULL
     OR to_regclass('public.modelo_aviamentos') IS NULL
     OR to_regclass('public.modelo_grades') IS NULL
     OR to_regclass('public.modelo_servico_mo') IS NULL
     OR to_regclass('public.modelo_prova_comentarios') IS NULL
     OR to_regclass('public.cad_tecidos') IS NULL
     OR to_regclass('public.cad_tecido_variantes') IS NULL
     OR to_regclass('public.cad_grades') IS NULL
     OR to_regclass('public.cad_aviamentos') IS NULL
     OR to_regclass('public.cad_etiquetas') IS NULL THEN
    RAISE EXCEPTION 's3c_grants: tabela ausente' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('modelo_etiquetas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_observacoes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_tecidos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_tecido_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_tecido_oc_links', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_aviamentos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_grades', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_servico_mo', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('modelo_prova_comentarios', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('cad_tecidos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('cad_tecido_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('cad_grades', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('cad_aviamentos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('cad_etiquetas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    SELECT coalesce(c.relacl::text, ''),
           coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped), '')
      INTO v_acl, v_cols
      FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t);
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's3c_grants: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE TRUNCATE ON TABLE public.modelo_etiquetas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_etiquetas FROM anon;
REVOKE TRUNCATE ON TABLE public.modelo_observacoes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_observacoes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecidos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecidos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_variantes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_oc_links FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_oc_links FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_aviamentos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_aviamentos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_grades FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_grades FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_servico_mo FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_servico_mo FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_prova_comentarios FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_prova_comentarios FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecidos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecidos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecido_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecido_variantes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_grades FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_grades FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_aviamentos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_aviamentos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_etiquetas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_etiquetas FROM anon;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelo_etiquetas', 'authenticated', ARRAY['TRUNCATE']),
      ('modelo_etiquetas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_observacoes', 'authenticated', ARRAY['TRUNCATE']),
      ('modelo_observacoes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_tecidos', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_tecidos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_tecido_variantes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_tecido_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_tecido_oc_links', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_tecido_oc_links', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_aviamentos', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_aviamentos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_grades', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_grades', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_servico_mo', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_servico_mo', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_prova_comentarios', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('modelo_prova_comentarios', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_tecidos', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_tecidos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_tecido_variantes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_tecido_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_grades', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_grades', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_aviamentos', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_aviamentos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_etiquetas', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad_etiquetas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
    ) AS x(t, papel, privs) LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3c_grants: pos-condicao falhou: % ainda tem privilegio revogado em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), 'SELECT') THEN
      RAISE EXCEPTION 's3c_grants: pos-condicao falhou: % perdeu o SELECT de %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege('service_role', to_regclass('public.' || r.t), 'INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 's3c_grants: pos-condicao falhou: service_role perdeu escrita em %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['modelo_etiquetas', 'modelo_observacoes']) t
              WHERE NOT has_table_privilege('authenticated', to_regclass('public.' || t), 'INSERT, UPDATE, DELETE, SELECT')) THEN
    RAISE EXCEPTION 's3c_grants: pos-condicao falhou: a tela perdeu a escrita direta em etiquetas/observacoes' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.modelo_etiquetas'::regclass, 'public.modelo_observacoes'::regclass, 'public.modelo_tecidos'::regclass, 'public.modelo_tecido_variantes'::regclass, 'public.modelo_tecido_oc_links'::regclass, 'public.modelo_aviamentos'::regclass, 'public.modelo_grades'::regclass, 'public.modelo_servico_mo'::regclass, 'public.modelo_prova_comentarios'::regclass, 'public.cad_tecidos'::regclass, 'public.cad_tecido_variantes'::regclass, 'public.cad_grades'::regclass, 'public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass)
              AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 's3c_grants: pos-condicao falhou: grant por coluna inesperado' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
