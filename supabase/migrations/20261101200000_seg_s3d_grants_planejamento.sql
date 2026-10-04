-- Reforço de segurança — sub-release S3d ("Planejamento, produtos, Plan. Tecido e importação"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3d.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§2.6, §2.7, §3, §5, §6 S3d); plano: plan.md (P-231 = D2 A).
-- Escrita direta do cliente (§2.6/§2.7): modelos perde so TRUNCATE (a tela grava direto, com o gatilho de pagina);
-- produtos_acabados/produtos_importados perdem I/U/D/T e ganham UPDATE so em mix_id e modelo_id (TAM-1 fechado);
-- produto_acabado_variantes, produto_importado_variantes, produto_importado_etapas e as 12 plan_tecido_* graváveis perdem
-- I/U/D/T (plan_tecido_snapshots ja era so leitura). anon perde I/U/D/T nas 19. SELECT fica. Fecha tambem o B3
-- 'plan_tecido_slots.modelo_id UPDATE=t' e torna o C2 da S4 (policies modgate_* do Plan. Tecido) dispensavel para escrita.
-- Trava: GRANT/REVOKE de tabela = catálogo — medido na cópia (pg_locks em txn revertida, seg-s3d.test.ts): nenhuma
-- trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101200000_seg_s3d_grants_planejamento_down.sql (LIFO: 20261101210000_down → 200000_down → 190000_down, ANTES dos inversos da S3c/S3b/S3a/S2/S1 e
-- de releases anteriores que guardam por md5 as mesmas funções — ver s3d-report.md, seção "Cadeia md5").
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
    RAISE EXCEPTION 's3d_grants: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 's3d_grants: tabela ausente' USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 's3d_grants: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE TRUNCATE ON TABLE public.modelos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.modelos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_acabados FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_acabados FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_importados FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produtos_importados FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_acabado_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_acabado_variantes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_variantes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_etapas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.produto_importado_etapas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_linhas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_linhas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_materiais FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_materiais FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_oc_aplicada FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_oc_aplicada FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_ocs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_ocs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_paleta FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_paleta FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_pedido_fotos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_pedido_fotos FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slot_oc FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slot_oc FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slots FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_slots FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecao_categorias FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecao_categorias FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecoes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_subcolecoes FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.plan_tecido_variantes FROM anon;
GRANT UPDATE (mix_id, modelo_id) ON TABLE public.produtos_acabados TO authenticated;
GRANT UPDATE (mix_id, modelo_id) ON TABLE public.produtos_importados TO authenticated;

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
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3d_grants: pos-condicao falhou: % ainda tem privilegio revogado em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), 'SELECT') THEN
      RAISE EXCEPTION 's3d_grants: pos-condicao falhou: % perdeu o SELECT de %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege('service_role', to_regclass('public.' || r.t), 'INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 's3d_grants: pos-condicao falhou: service_role perdeu escrita em %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.modelos', 'INSERT, UPDATE, DELETE, SELECT') THEN
    RAISE EXCEPTION 's3d_grants: pos-condicao falhou: a tela perdeu a escrita direta em modelos' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('produtos_acabados', 'mix_id,modelo_id'),
      ('produtos_importados', 'mix_id,modelo_id'),
      ('produto_acabado_variantes', ''),
      ('produto_importado_variantes', ''),
      ('produto_importado_etapas', ''),
      ('plan_tecido', ''),
      ('plan_tecido_linhas', ''),
      ('plan_tecido_materiais', ''),
      ('plan_tecido_oc_aplicada', ''),
      ('plan_tecido_ocs', ''),
      ('plan_tecido_paleta', ''),
      ('plan_tecido_pedido_fotos', ''),
      ('plan_tecido_slot_oc', ''),
      ('plan_tecido_slots', ''),
      ('plan_tecido_snapshots', ''),
      ('plan_tecido_subcolecao_categorias', ''),
      ('plan_tecido_subcolecoes', ''),
      ('plan_tecido_variantes', '')
    ) AS x(t, cols) LOOP
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
    IF coalesce(v, '') <> r.cols THEN
      RAISE EXCEPTION 's3d_grants: pos-condicao falhou: UPDATE de authenticated em % = % (esperado %)', r.t, v, r.cols USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
