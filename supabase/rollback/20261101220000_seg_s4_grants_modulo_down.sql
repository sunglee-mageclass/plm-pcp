-- Inverso de supabase/migrations/20261101220000_seg_s4_grants_modulo.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s4.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§S4, C1/C2) — REAVALIADO: sem CREATE POLICY (ver s4-report.md).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422).
-- Trava: GRANT/REVOKE = catálogo (medido em seg-s4.test.ts): nenhuma tabela acima de AccessShare; nada de auth/storage.
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
    RAISE EXCEPTION 's4_grants_down: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  -- LIFO (fix round S4): a S5 (20261101240000) guarda a ACL destas tabelas; com ela no banco, PARE (volte a S5 antes).
  IF to_regprocedure('public.tenant_module_enabled(text)') IS NOT NULL
     AND NOT has_function_privilege('anon', 'public.tenant_module_enabled(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 's4_grants_down: rode antes a volta da S5 20261101240000_down (a faxina de privilegios ainda esta no banco)' USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 's4_grants_down: tabela % ausente', r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's4_grants_down: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

GRANT TRUNCATE ON TABLE public.colecao_mixes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_mixes TO anon;
GRANT TRUNCATE ON TABLE public.colecao_pv_itens TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_pv_itens TO anon;
GRANT TRUNCATE ON TABLE public.colecao_semana_categorias TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_semana_categorias TO anon;
GRANT TRUNCATE ON TABLE public.colecao_semanas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_semanas TO anon;
GRANT TRUNCATE ON TABLE public.colecao_subcolecoes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecao_subcolecoes TO anon;
GRANT TRUNCATE ON TABLE public.mix_padrao_linhas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.mix_padrao_linhas TO anon;
GRANT TRUNCATE ON TABLE public.mix_padroes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.mix_padroes TO anon;
GRANT TRUNCATE ON TABLE public.otb_simulacao_linhas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_linhas TO anon;
GRANT TRUNCATE ON TABLE public.otb_simulacao_modelos TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_modelos TO anon;
GRANT TRUNCATE ON TABLE public.otb_simulacao_variantes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_variantes TO anon;
GRANT TRUNCATE ON TABLE public.otb_simulacao_unidades TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacao_unidades TO anon;
GRANT TRUNCATE ON TABLE public.otb_simulacoes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.otb_simulacoes TO anon;
GRANT TRUNCATE ON TABLE public.colecoes TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.colecoes TO anon;

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
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's4_grants_down: pos-condicao falhou: % nao voltou a ter os privilegios de antes em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
