-- Inverso de supabase/migrations/20261101200000_seg_s3d_grants_planejamento.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3d.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.6, §2.7, §3, §5, §6 S3d); plano: plan.md (P-231 = D2 A).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1 + S2 + S3a).
-- Trava: GRANT/REVOKE de tabela = catálogo — medido na cópia (pg_locks em txn revertida, seg-s3d.test.ts): nenhuma
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
    RAISE EXCEPTION 's3d_grants_down: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.modelos') IS NULL
     OR to_regclass('public.produtos_acabados') IS NULL
     OR to_regclass('public.produtos_importados') IS NULL
     OR to_regclass('public.produto_acabado_variantes') IS NULL
     OR to_regclass('public.produto_importado_variantes') IS NULL
     OR to_regclass('public.produto_importado_etapas') IS NULL
     OR to_regclass('public.plan_tecido') IS NULL
     OR to_regclass('public.plan_tecido_linhas') IS NULL
     OR to_regclass('public.plan_tecido_materiais') IS NULL
     OR to_regclass('public.plan_tecido_oc_aplicada') IS NULL
     OR to_regclass('public.plan_tecido_ocs') IS NULL
     OR to_regclass('public.plan_tecido_paleta') IS NULL
     OR to_regclass('public.plan_tecido_pedido_fotos') IS NULL
     OR to_regclass('public.plan_tecido_slot_oc') IS NULL
     OR to_regclass('public.plan_tecido_slots') IS NULL
     OR to_regclass('public.plan_tecido_snapshots') IS NULL
     OR to_regclass('public.plan_tecido_subcolecao_categorias') IS NULL
     OR to_regclass('public.plan_tecido_subcolecoes') IS NULL
     OR to_regclass('public.plan_tecido_variantes') IS NULL THEN
    RAISE EXCEPTION 's3d_grants_down: tabela ausente' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('modelos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('produtos_acabados', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('produtos_importados', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'modelo_id={authenticated=w/postgres} mix_id={authenticated=w/postgres}'),
      ('produto_acabado_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('produto_importado_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('produto_importado_etapas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_linhas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_materiais', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_oc_aplicada', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_ocs', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_paleta', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_pedido_fotos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_slot_oc', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_slots', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_snapshots', '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}', '', '{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres,authenticated=r/postgres}', ''),
      ('plan_tecido_subcolecao_categorias', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_subcolecoes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('plan_tecido_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    SELECT coalesce(c.relacl::text, ''),
           coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped), '')
      INTO v_acl, v_cols
      FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t);
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's3d_grants_down: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE UPDATE (mix_id, modelo_id) ON TABLE public.produtos_acabados FROM authenticated;
REVOKE UPDATE (mix_id, modelo_id) ON TABLE public.produtos_importados FROM authenticated;
GRANT TRUNCATE ON TABLE public.modelos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelos TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_acabados TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_acabados TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_importados TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_importados TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_acabado_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_acabado_variantes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_variantes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_etapas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_etapas TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_linhas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_linhas TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_materiais TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_materiais TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_oc_aplicada TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_oc_aplicada TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_ocs TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_ocs TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_paleta TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_paleta TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_pedido_fotos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_pedido_fotos TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slot_oc TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slot_oc TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slots TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slots TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecao_categorias TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecao_categorias TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecoes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecoes TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_variantes TO anon;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelos', 'authenticated', ARRAY['TRUNCATE']),
      ('modelos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produtos_acabados', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produtos_acabados', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produtos_importados', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produtos_importados', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produto_acabado_variantes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produto_acabado_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produto_importado_variantes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produto_importado_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produto_importado_etapas', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('produto_importado_etapas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_linhas', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_linhas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_materiais', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_materiais', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_oc_aplicada', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_oc_aplicada', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_ocs', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_ocs', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_paleta', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_paleta', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_pedido_fotos', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_pedido_fotos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_slot_oc', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_slot_oc', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_slots', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_slots', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_subcolecao_categorias', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_subcolecao_categorias', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_subcolecoes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_subcolecoes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_variantes', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('plan_tecido_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
    ) AS x(t, papel, privs) LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3d_grants_down: pos-condicao falhou: % nao voltou a ter os privilegios de antes em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid IN ('public.modelos'::regclass, 'public.produtos_acabados'::regclass, 'public.produtos_importados'::regclass, 'public.produto_acabado_variantes'::regclass, 'public.produto_importado_variantes'::regclass, 'public.produto_importado_etapas'::regclass, 'public.plan_tecido'::regclass, 'public.plan_tecido_linhas'::regclass, 'public.plan_tecido_materiais'::regclass, 'public.plan_tecido_oc_aplicada'::regclass, 'public.plan_tecido_ocs'::regclass, 'public.plan_tecido_paleta'::regclass, 'public.plan_tecido_pedido_fotos'::regclass, 'public.plan_tecido_slot_oc'::regclass, 'public.plan_tecido_slots'::regclass, 'public.plan_tecido_snapshots'::regclass, 'public.plan_tecido_subcolecao_categorias'::regclass, 'public.plan_tecido_subcolecoes'::regclass, 'public.plan_tecido_variantes'::regclass)
              AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 's3d_grants_down: pos-condicao falhou: sobrou grant por coluna' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
