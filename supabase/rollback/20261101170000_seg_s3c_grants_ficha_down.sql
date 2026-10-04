-- Inverso de supabase/migrations/20261101170000_seg_s3c_grants_ficha.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3c.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.5, §2.7 B3, §5, §6 S3c); plano: plan.md (P-231 = D2 A; P-244 = B).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2 + S3a).
-- Trava: GRANT/REVOKE de tabela = catálogo — medido na cópia (pg_locks em txn revertida, seg-s3c.test.ts): nenhuma
-- trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
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
    RAISE EXCEPTION 's3c_grants_down: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 's3c_grants_down: tabela ausente' USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 's3c_grants_down: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

GRANT TRUNCATE ON TABLE public.modelo_etiquetas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_etiquetas TO anon;
GRANT TRUNCATE ON TABLE public.modelo_observacoes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_observacoes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecidos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecidos TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_variantes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_oc_links TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_tecido_oc_links TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_aviamentos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_aviamentos TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_grades TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_grades TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_servico_mo TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_servico_mo TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_prova_comentarios TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelo_prova_comentarios TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecidos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecidos TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecido_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_tecido_variantes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_grades TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_grades TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_aviamentos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_aviamentos TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_etiquetas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad_etiquetas TO anon;

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
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3c_grants_down: pos-condicao falhou: % nao voltou a ter os privilegios de antes em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.modelo_etiquetas'::regclass, 'public.modelo_observacoes'::regclass, 'public.modelo_tecidos'::regclass, 'public.modelo_tecido_variantes'::regclass, 'public.modelo_tecido_oc_links'::regclass, 'public.modelo_aviamentos'::regclass, 'public.modelo_grades'::regclass, 'public.modelo_servico_mo'::regclass, 'public.modelo_prova_comentarios'::regclass, 'public.cad_tecidos'::regclass, 'public.cad_tecido_variantes'::regclass, 'public.cad_grades'::regclass, 'public.cad_aviamentos'::regclass, 'public.cad_etiquetas'::regclass)
              AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 's3c_grants_down: pos-condicao falhou: sobrou grant por coluna' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
