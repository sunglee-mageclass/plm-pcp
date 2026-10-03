-- Inverso de supabase/migrations/20261101110000_seg_s3a_grants_oc.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3a.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§1, §2.1-2.3, §3, §6 S3a); plano: plan.md (P-231 = D2 A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2).
-- Trava: GRANT/REVOKE de tabela = catálogo (pg_class.relacl/pg_attribute.attacl) — medido na cópia (pg_locks em txn
-- revertida, seg-s3a.test.ts): nenhuma trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
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
    RAISE EXCEPTION 's3a_grants_down: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.ocs_tecido') IS NULL
     OR to_regclass('public.ocs_tecido_itens') IS NULL
     OR to_regclass('public.ocs_aviamento') IS NULL
     OR to_regclass('public.ocs_etiqueta') IS NULL
     OR to_regclass('public.ocs_p_acabado') IS NULL
     OR to_regclass('public.ocs_importado') IS NULL
     OR to_regclass('public.ocs_importado_etapas') IS NULL
     OR to_regclass('public.ordens_saida_tecido') IS NULL
     OR to_regclass('public.ordens_saida_tecido_itens') IS NULL
     OR to_regclass('public.ordens_saida_aviamento') IS NULL
     OR to_regclass('public.ordens_saida_aviamento_itens') IS NULL THEN
    RAISE EXCEPTION 's3a_grants_down: tabela ausente' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'numero_pedido={authenticated=w/postgres} rolo_codigo={authenticated=w/postgres} rolo_rua={authenticated=w/postgres} rolo_prateleira={authenticated=w/postgres} nfs={authenticated=w/postgres} recebimento_responsavel_id={authenticated=w/postgres} recebimento_responsavel_nome={authenticated=w/postgres}'),
      ('ocs_tecido_itens', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'cancelado={authenticated=w/postgres} cq_observacao={authenticated=w/postgres} cq_ok={authenticated=w/postgres} cq_alerta_status={authenticated=w/postgres}'),
      ('ocs_aviamento', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rdxtm/postgres,service_role=arwdDxtm/postgres}', 'nfs={authenticated=w/postgres}'),
      ('ocs_etiqueta', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rdxtm/postgres,service_role=arwdDxtm/postgres}', 'data_nota_entrada={authenticated=w/postgres}'),
      ('ocs_p_acabado', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ocs_importado', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ocs_importado_etapas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ordens_saida_tecido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ordens_saida_tecido_itens', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ordens_saida_aviamento', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ordens_saida_aviamento_itens', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    SELECT coalesce(c.relacl::text, ''),
           coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped), '')
      INTO v_acl, v_cols
      FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t);
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's3a_grants_down: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE UPDATE (numero_pedido, rolo_codigo, rolo_rua, rolo_prateleira, nfs, recebimento_responsavel_id, recebimento_responsavel_nome) ON TABLE public.ocs_tecido FROM authenticated;
REVOKE UPDATE (cancelado, cq_observacao, cq_ok, cq_alerta_status) ON TABLE public.ocs_tecido_itens FROM authenticated;
REVOKE UPDATE (nfs) ON TABLE public.ocs_aviamento FROM authenticated;
REVOKE UPDATE (data_nota_entrada) ON TABLE public.ocs_etiqueta FROM authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido_itens TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido_itens TO anon;
GRANT INSERT, UPDATE, TRUNCATE ON TABLE public.ocs_aviamento TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_aviamento TO anon;
GRANT INSERT, UPDATE, TRUNCATE ON TABLE public.ocs_etiqueta TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_etiqueta TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_p_acabado TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_p_acabado TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado_etapas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado_etapas TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido_itens TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido_itens TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento_itens TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento_itens TO anon;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_tecido', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_tecido_itens', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_tecido_itens', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_aviamento', 'authenticated', ARRAY['INSERT', 'UPDATE', 'TRUNCATE']),
      ('ocs_aviamento', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_etiqueta', 'authenticated', ARRAY['INSERT', 'UPDATE', 'TRUNCATE']),
      ('ocs_etiqueta', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_p_acabado', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_p_acabado', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_importado', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_importado', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_importado_etapas', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_importado_etapas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_tecido', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_tecido', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_tecido_itens', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_tecido_itens', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_aviamento', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_aviamento', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_aviamento_itens', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ordens_saida_aviamento_itens', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
    ) AS x(t, papel, privs) LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3a_grants_down: pos-condicao falhou: % nao voltou a ter os privilegios de antes em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.ocs_tecido'::regclass, 'public.ocs_tecido_itens'::regclass, 'public.ocs_aviamento'::regclass, 'public.ocs_etiqueta'::regclass, 'public.ocs_p_acabado'::regclass, 'public.ocs_importado'::regclass, 'public.ocs_importado_etapas'::regclass, 'public.ordens_saida_tecido'::regclass, 'public.ordens_saida_tecido_itens'::regclass, 'public.ordens_saida_aviamento'::regclass, 'public.ordens_saida_aviamento_itens'::regclass)
              AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 's3a_grants_down: pos-condicao falhou: sobrou grant por coluna' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
