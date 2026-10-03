-- Inverso de supabase/migrations/20261031200000_seg_s2_grants_dinheiro.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S2, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção + S1).
-- Trava: GRANT/REVOKE de tabela = catálogo (pg_class.relacl/pg_attribute.attacl) — medido na cópia (pg_locks em txn
-- revertida, seg-s2.test.ts): nenhuma trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 's2_grants_down: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.parcelas') IS NULL
     OR to_regclass('public.parcelas_servico') IS NULL
     OR to_regclass('public.estoque_tecido_baixas') IS NULL
     OR to_regclass('public.ocs_aviamento_itens') IS NULL
     OR to_regclass('public.ocs_etiqueta_itens') IS NULL THEN
    RAISE EXCEPTION 's2_grants_down: tabela ausente' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.parcelas_servico'::regclass AND NOT a.attisdropped
        AND a.attname IN ('data_vencimento', 'status', 'data_pagamento', 'comprovante_url')) <> 4 THEN
    RAISE EXCEPTION 's2_grants_down: colunas de parcelas_servico mudaram' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

REVOKE UPDATE (data_vencimento, status, data_pagamento, comprovante_url) ON TABLE public.parcelas_servico FROM authenticated;
GRANT INSERT, DELETE, TRUNCATE ON TABLE public.parcelas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parcelas TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parcelas_servico TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parcelas_servico TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.estoque_tecido_baixas TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.estoque_tecido_baixas TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_aviamento_itens TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_aviamento_itens TO anon;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_etiqueta_itens TO authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_etiqueta_itens TO anon;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('parcelas', 'authenticated', ARRAY['INSERT', 'DELETE', 'TRUNCATE']),
      ('parcelas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('parcelas_servico', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('parcelas_servico', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('estoque_tecido_baixas', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('estoque_tecido_baixas', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_aviamento_itens', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_aviamento_itens', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_etiqueta_itens', 'authenticated', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']),
      ('ocs_etiqueta_itens', 'anon', ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
    ) AS x(t, papel, privs) LOOP
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's2_grants_down: pos-condicao falhou: % nao voltou a ter os privilegios de antes em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.parcelas_servico'::regclass AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 's2_grants_down: pos-condicao falhou: sobrou grant por coluna em parcelas_servico' USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('authenticated', 'public.parcelas', 'UPDATE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['data_vencimento', 'status', 'data_pagamento', 'comprovante_url']) col
                 WHERE NOT has_column_privilege('authenticated', 'public.parcelas', col, 'UPDATE')) THEN
    RAISE EXCEPTION 's2_grants_down: pos-condicao falhou: UPDATE de parcelas (4 colunas) diferente do de antes' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
