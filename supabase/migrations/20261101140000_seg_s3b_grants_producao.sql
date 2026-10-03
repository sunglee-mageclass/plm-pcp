-- Reforço de segurança — sub-release S3b ("Produção, Expedição e Explosão"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3b.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.3-2.4, §3, §6 S3b); plano: plan.md (P-231 = D2 A; P-245 = A).
-- Escrita direta do cliente na Producao (§1.3/§1.4): cad perde I/U/D/T e ganha UPDATE so em direcionamento_status,
-- direcionamento_confirmado_at, sem_acabamento e observacoes_molde; controle_qualidade so em fotografado_variantes;
-- producao_oficina perde DELETE/TRUNCATE (a tela grava o formulario inteiro: INSERT/UPDATE ficam, com o gatilho de pagina);
-- cq_variantes, cq_pos_variantes, direcionamento_controle, lancamentos e producao_terceirizados (a tela so grava por RPC)
-- perdem I/U/D/T. anon perde I/U/D/T nas 8. SELECT fica. Escritas do servidor = SECURITY DEFINER (owner postgres).
-- Trava: GRANT/REVOKE de tabela = catálogo — medido na cópia (pg_locks em txn revertida, seg-s3b.test.ts): nenhuma
-- trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101140000_seg_s3b_grants_producao_down.sql (LIFO: 20261101150000_down → 140000_down → 130000_down, ANTES dos inversos da S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3b-report.md, seção "Cadeia md5").
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
    RAISE EXCEPTION 's3b_grants: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.cad') IS NULL
     OR to_regclass('public.controle_qualidade') IS NULL
     OR to_regclass('public.producao_oficina') IS NULL
     OR to_regclass('public.cq_variantes') IS NULL
     OR to_regclass('public.cq_pos_variantes') IS NULL
     OR to_regclass('public.direcionamento_controle') IS NULL
     OR to_regclass('public.lancamentos') IS NULL
     OR to_regclass('public.producao_terceirizados') IS NULL THEN
    RAISE EXCEPTION 's3b_grants: tabela ausente' USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 's3b_grants: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cad FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.controle_qualidade FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.controle_qualidade FROM anon;
REVOKE DELETE, TRUNCATE ON TABLE public.producao_oficina FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.producao_oficina FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_variantes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_pos_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.cq_pos_variantes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.direcionamento_controle FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.direcionamento_controle FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.lancamentos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.lancamentos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.producao_terceirizados FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.producao_terceirizados FROM anon;
GRANT UPDATE (direcionamento_status, direcionamento_confirmado_at, sem_acabamento, observacoes_molde) ON TABLE public.cad TO authenticated;
GRANT UPDATE (fotografado_variantes) ON TABLE public.controle_qualidade TO authenticated;

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
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3b_grants: pos-condicao falhou: % ainda tem privilegio revogado em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), 'SELECT') THEN
      RAISE EXCEPTION 's3b_grants: pos-condicao falhou: % perdeu o SELECT de %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege('service_role', to_regclass('public.' || r.t), 'INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 's3b_grants: pos-condicao falhou: service_role perdeu escrita em %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('cad', ARRAY['direcionamento_status', 'direcionamento_confirmado_at', 'sem_acabamento', 'observacoes_molde']::text[]),
      ('controle_qualidade', ARRAY['fotografado_variantes']::text[]),
      ('cq_variantes', ARRAY[]::text[]),
      ('cq_pos_variantes', ARRAY[]::text[]),
      ('direcionamento_controle', ARRAY[]::text[]),
      ('lancamentos', ARRAY[]::text[]),
      ('producao_terceirizados', ARRAY[]::text[])
    ) AS x(t, cols) LOOP
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
    IF coalesce(v, '') <> coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(r.cols) x), '') THEN
      RAISE EXCEPTION 's3b_grants: pos-condicao falhou: UPDATE de authenticated em % = % (esperado %)', r.t, v, r.cols USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.producao_oficina', 'INSERT, UPDATE, SELECT') THEN
    RAISE EXCEPTION 's3b_grants: pos-condicao falhou: a tela da Oficina perdeu INSERT/UPDATE' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['cad', 'controle_qualidade', 'producao_oficina', 'cq_variantes', 'cq_pos_variantes', 'direcionamento_controle', 'lancamentos', 'producao_terceirizados']) t
              WHERE has_any_column_privilege('anon', to_regclass('public.' || t), 'UPDATE, INSERT')) THEN
    RAISE EXCEPTION 's3b_grants: pos-condicao falhou: anon ainda escreve coluna' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
      ('cad', 'tenant_id'),
      ('cad', 'modelo_id'),
      ('cad', 'enviado_corte'),
      ('cad', 'rev'),
      ('cad', 'data_enviado_corte'),
      ('controle_qualidade', 'status'),
      ('controle_qualidade', 'status_pos'),
      ('controle_qualidade', 'rev'),
      ('controle_qualidade', 'cad_id')
    ) AS x(t, col) WHERE has_column_privilege('authenticated', to_regclass('public.' || x.t), x.col, 'UPDATE')) THEN
    RAISE EXCEPTION 's3b_grants: pos-condicao falhou: authenticated ainda muda coluna derivada' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
