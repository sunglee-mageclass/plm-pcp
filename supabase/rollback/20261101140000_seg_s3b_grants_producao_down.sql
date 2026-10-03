-- Inverso de supabase/migrations/20261101140000_seg_s3b_grants_producao.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3b.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.3-2.4, §3, §6 S3b); plano: plan.md (P-231 = D2 A; P-245 = A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2 + S3a).
-- Trava: GRANT/REVOKE de tabela = catálogo — medido na cópia (pg_locks em txn revertida, seg-s3b.test.ts): nenhuma
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
    RAISE EXCEPTION 's3b_grants_down: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.cad') IS NULL
     OR to_regclass('public.controle_qualidade') IS NULL
     OR to_regclass('public.producao_oficina') IS NULL
     OR to_regclass('public.cq_variantes') IS NULL
     OR to_regclass('public.cq_pos_variantes') IS NULL
     OR to_regclass('public.direcionamento_controle') IS NULL
     OR to_regclass('public.lancamentos') IS NULL
     OR to_regclass('public.producao_terceirizados') IS NULL THEN
    RAISE EXCEPTION 's3b_grants_down: tabela ausente' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('cad', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'observacoes_molde={authenticated=w/postgres} direcionamento_status={authenticated=w/postgres} direcionamento_confirmado_at={authenticated=w/postgres} sem_acabamento={authenticated=w/postgres}'),
      ('controle_qualidade', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'fotografado_variantes={authenticated=w/postgres}'),
      ('producao_oficina', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('cq_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('cq_pos_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('direcionamento_controle', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('lancamentos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('producao_terceirizados', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    SELECT coalesce(c.relacl::text, ''),
           coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped), '')
      INTO v_acl, v_cols
      FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t);
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's3b_grants_down: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE UPDATE (direcionamento_status, direcionamento_confirmado_at, sem_acabamento, observacoes_molde) ON TABLE public.cad FROM authenticated;
REVOKE UPDATE (fotografado_variantes) ON TABLE public.controle_qualidade FROM authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.controle_qualidade TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.controle_qualidade TO anon;
GRANT DELETE, TRUNCATE ON TABLE public.producao_oficina TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.producao_oficina TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_variantes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_pos_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_pos_variantes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.direcionamento_controle TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.direcionamento_controle TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.lancamentos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.lancamentos TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.producao_terceirizados TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.producao_terceirizados TO anon;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cad', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cad', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('controle_qualidade', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('controle_qualidade', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('producao_oficina', 'authenticated', ARRAY['DELETE', 'TRUNCATE']),
      ('producao_oficina', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cq_variantes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cq_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cq_pos_variantes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('cq_pos_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('direcionamento_controle', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('direcionamento_controle', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('lancamentos', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('lancamentos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('producao_terceirizados', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('producao_terceirizados', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
    ) AS x(t, papel, privs) LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3b_grants_down: pos-condicao falhou: % nao voltou a ter os privilegios de antes em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.cad'::regclass, 'public.controle_qualidade'::regclass, 'public.producao_oficina'::regclass, 'public.cq_variantes'::regclass, 'public.cq_pos_variantes'::regclass, 'public.direcionamento_controle'::regclass, 'public.lancamentos'::regclass, 'public.producao_terceirizados'::regclass)
              AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 's3b_grants_down: pos-condicao falhou: sobrou grant por coluna' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
