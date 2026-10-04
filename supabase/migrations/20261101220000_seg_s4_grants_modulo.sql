-- Reforço de segurança — sub-release S4 ("Brechas de módulo": C1 OTB, C2 Plan. Tecido). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s4.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S4, C1/C2) — REAVALIADO: sem CREATE POLICY (ver s4-report.md).
-- Brechas de modulo (C1/C2) SEM policy. TRUNCATE (pula gatilho e RLS) sai de authenticated nas 13 tabelas do OTB/mix; anon
-- perde I/U/D/T nelas. SELECT, INSERT, UPDATE e DELETE de authenticated FICAM (as RPCs INVOKER do OTB gravam como o cliente;
-- o gatilho de modulo da 20261101230000 confere). C2: exige o estado da S3d (as 12 plan_tecido_* gravaveis sem escrita do
-- cliente) - senao recusa.
-- Trava: GRANT/REVOKE = catálogo (medido em seg-s4.test.ts): nenhuma tabela acima de AccessShare; nada de auth/storage.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101220000_seg_s4_grants_modulo_down.sql (LIFO: 20261101230000_down → 220000_down, ANTES dos inversos da S3d/S3c/S3b/S3a).
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
    RAISE EXCEPTION 's4_grants: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  -- C2 (Plan. Tecido): a brecha de escrita foi fechada pela S3d (REVOKE I/U/D/T do cliente nas plan_tecido_*). Sem ela, PARE.
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['plan_tecido', 'plan_tecido_linhas', 'plan_tecido_materiais', 'plan_tecido_oc_aplicada', 'plan_tecido_ocs', 'plan_tecido_paleta', 'plan_tecido_pedido_fotos', 'plan_tecido_slot_oc', 'plan_tecido_slots', 'plan_tecido_subcolecao_categorias', 'plan_tecido_subcolecoes', 'plan_tecido_variantes']) t
              WHERE has_table_privilege('authenticated', to_regclass('public.' || t), 'INSERT, UPDATE, DELETE, TRUNCATE')) THEN
    RAISE EXCEPTION 's4_grants: rode antes a S3d 20261101200000 (plan_tecido_* ainda graváveis pelo cliente - C2 aberto)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('colecao_mixes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('colecao_pv_itens', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('colecao_semana_categorias', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('colecao_semanas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('colecao_subcolecoes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('mix_padrao_linhas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('mix_padroes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('otb_simulacao_linhas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('otb_simulacao_modelos', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('otb_simulacao_variantes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('otb_simulacao_unidades', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('otb_simulacoes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('colecoes', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    SELECT coalesce(c.relacl::text, ''),
           coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped), '')
      INTO v_acl, v_cols
      FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t);
    IF v_acl IS NULL THEN
      RAISE EXCEPTION 's4_grants: tabela % ausente', r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's4_grants: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE TRUNCATE ON TABLE public.colecao_mixes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_mixes FROM anon;
REVOKE TRUNCATE ON TABLE public.colecao_pv_itens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_pv_itens FROM anon;
REVOKE TRUNCATE ON TABLE public.colecao_semana_categorias FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_semana_categorias FROM anon;
REVOKE TRUNCATE ON TABLE public.colecao_semanas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_semanas FROM anon;
REVOKE TRUNCATE ON TABLE public.colecao_subcolecoes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_subcolecoes FROM anon;
REVOKE TRUNCATE ON TABLE public.mix_padrao_linhas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.mix_padrao_linhas FROM anon;
REVOKE TRUNCATE ON TABLE public.mix_padroes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.mix_padroes FROM anon;
REVOKE TRUNCATE ON TABLE public.otb_simulacao_linhas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_linhas FROM anon;
REVOKE TRUNCATE ON TABLE public.otb_simulacao_modelos FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_modelos FROM anon;
REVOKE TRUNCATE ON TABLE public.otb_simulacao_variantes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_variantes FROM anon;
REVOKE TRUNCATE ON TABLE public.otb_simulacao_unidades FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_unidades FROM anon;
REVOKE TRUNCATE ON TABLE public.otb_simulacoes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacoes FROM anon;
REVOKE TRUNCATE ON TABLE public.colecoes FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecoes FROM anon;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('colecao_mixes', 'authenticated', ARRAY['TRUNCATE']),
      ('colecao_mixes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('colecao_pv_itens', 'authenticated', ARRAY['TRUNCATE']),
      ('colecao_pv_itens', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('colecao_semana_categorias', 'authenticated', ARRAY['TRUNCATE']),
      ('colecao_semana_categorias', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('colecao_semanas', 'authenticated', ARRAY['TRUNCATE']),
      ('colecao_semanas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('colecao_subcolecoes', 'authenticated', ARRAY['TRUNCATE']),
      ('colecao_subcolecoes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('mix_padrao_linhas', 'authenticated', ARRAY['TRUNCATE']),
      ('mix_padrao_linhas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('mix_padroes', 'authenticated', ARRAY['TRUNCATE']),
      ('mix_padroes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('otb_simulacao_linhas', 'authenticated', ARRAY['TRUNCATE']),
      ('otb_simulacao_linhas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('otb_simulacao_modelos', 'authenticated', ARRAY['TRUNCATE']),
      ('otb_simulacao_modelos', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('otb_simulacao_variantes', 'authenticated', ARRAY['TRUNCATE']),
      ('otb_simulacao_variantes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('otb_simulacao_unidades', 'authenticated', ARRAY['TRUNCATE']),
      ('otb_simulacao_unidades', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('otb_simulacoes', 'authenticated', ARRAY['TRUNCATE']),
      ('otb_simulacoes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('colecoes', 'authenticated', ARRAY['TRUNCATE']),
      ('colecoes', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
    ) AS x(t, papel, privs) LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's4_grants: pos-condicao falhou: % ainda tem privilegio revogado em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['colecao_mixes', 'colecao_pv_itens', 'colecao_semana_categorias', 'colecao_semanas', 'colecao_subcolecoes', 'mix_padrao_linhas', 'mix_padroes', 'otb_simulacao_linhas', 'otb_simulacao_modelos', 'otb_simulacao_variantes', 'otb_simulacao_unidades', 'otb_simulacoes', 'colecoes']) t
              WHERE NOT has_table_privilege('authenticated', to_regclass('public.' || t), 'SELECT, INSERT, UPDATE, DELETE')
                 OR NOT has_table_privilege('anon', to_regclass('public.' || t), 'SELECT')
                 OR NOT has_table_privilege('service_role', to_regclass('public.' || t), 'INSERT, UPDATE, DELETE, TRUNCATE')) THEN
    RAISE EXCEPTION 's4_grants: pos-condicao falhou: leitura/escrita das RPCs INVOKER/servidor mudou' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = ANY (ARRAY['public.colecao_mixes'::regclass, 'public.colecao_pv_itens'::regclass, 'public.colecao_semana_categorias'::regclass, 'public.colecao_semanas'::regclass, 'public.colecao_subcolecoes'::regclass, 'public.mix_padrao_linhas'::regclass, 'public.mix_padroes'::regclass, 'public.otb_simulacao_linhas'::regclass, 'public.otb_simulacao_modelos'::regclass, 'public.otb_simulacao_variantes'::regclass, 'public.otb_simulacao_unidades'::regclass, 'public.otb_simulacoes'::regclass, 'public.colecoes'::regclass, 'public.plan_tecido'::regclass, 'public.plan_tecido_linhas'::regclass, 'public.plan_tecido_materiais'::regclass, 'public.plan_tecido_oc_aplicada'::regclass, 'public.plan_tecido_ocs'::regclass, 'public.plan_tecido_paleta'::regclass, 'public.plan_tecido_pedido_fotos'::regclass, 'public.plan_tecido_slot_oc'::regclass, 'public.plan_tecido_slots'::regclass, 'public.plan_tecido_subcolecao_categorias'::regclass, 'public.plan_tecido_subcolecoes'::regclass, 'public.plan_tecido_variantes'::regclass])) <> 97 THEN
    RAISE EXCEPTION 's4_grants: pos-condicao falhou: policies mudaram (a S4 nao cria policy)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
