-- Reforço de segurança — Release S2 ("Dinheiro e estoque"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s2.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S2, RESPOSTAS DO DONO).
-- fin #11: parcelas perde INSERT/DELETE/TRUNCATE do cliente (o UPDATE ja era so em data_vencimento/status/data_pagamento/
-- comprovante_url); parcelas_servico passa a ter, como parcelas, SO UPDATE nessas 4 colunas (valor_pago, numero_parcela,
-- vencimento_manual e o resto: so o servidor). EST-1: o ledger estoque_tecido_baixas perde INSERT/UPDATE/DELETE/TRUNCATE do
-- cliente (invariante 4: baixa so pelas RPCs com guarda). AVI-1: idem nos itens de OC de aviamento e de insumo (o front
-- grava pelas RPCs salvar_oc_aviamento/salvar_oc_etiqueta). anon perde I/U/D/T nas 5. SELECT fica. ocs_tecido_itens NAO entra
-- (o front ainda faz UPDATE direto: CQ de tecido e alerta de rolo — achado para a S3). Todas as escritas do servidor sao
-- SECURITY DEFINER (owner postgres): nao dependem do grant do cliente. CASCADE de FK roda como o dono da tabela.
-- Trava: GRANT/REVOKE de tabela = catálogo (pg_class.relacl/pg_attribute.attacl) — medido na cópia (pg_locks em txn
-- revertida, seg-s2.test.ts): nenhuma trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261031200000_seg_s2_grants_dinheiro_down.sql (LIFO: os inversos da S2 rodam do mais novo ao mais antigo, ANTES dos inversos da S1 e de
-- releases anteriores que guardam por md5 as mesmas funções — ver s2-report.md, seção "Cadeia md5").
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
    RAISE EXCEPTION 's2_grants: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.parcelas') IS NULL
     OR to_regclass('public.parcelas_servico') IS NULL
     OR to_regclass('public.estoque_tecido_baixas') IS NULL
     OR to_regclass('public.ocs_aviamento_itens') IS NULL
     OR to_regclass('public.ocs_etiqueta_itens') IS NULL THEN
    RAISE EXCEPTION 's2_grants: tabela ausente' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = 'public.parcelas_servico'::regclass AND NOT a.attisdropped
        AND a.attname IN ('data_vencimento', 'status', 'data_pagamento', 'comprovante_url')) <> 4 THEN
    RAISE EXCEPTION 's2_grants: colunas de parcelas_servico mudaram' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('parcelas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=ardDxtm/postgres,service_role=arwdDxtm/postgres}', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'data_vencimento={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} status={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('parcelas_servico', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', 'data_vencimento={authenticated=w/postgres} status={authenticated=w/postgres} data_pagamento={authenticated=w/postgres} comprovante_url={authenticated=w/postgres}'),
      ('estoque_tecido_baixas', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ocs_aviamento_itens', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', ''),
      ('ocs_etiqueta_itens', '{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}', '', '{postgres=arwdDxtm/postgres,anon=rxtm/postgres,authenticated=rxtm/postgres,service_role=arwdDxtm/postgres}', '')
    ) AS x(t, a_acl, a_cols, d_acl, d_cols) LOOP
    SELECT coalesce(c.relacl::text, ''),
           coalesce((SELECT string_agg(a.attname || '=' || a.attacl::text, ' ' ORDER BY a.attnum) FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL AND NOT a.attisdropped), '')
      INTO v_acl, v_cols
      FROM pg_class c WHERE c.oid = to_regclass('public.' || r.t);
    IF NOT ((v_acl = r.a_acl AND v_cols = r.a_cols) OR (v_acl = r.d_acl AND v_cols = r.d_cols)) THEN
      RAISE EXCEPTION 's2_grants: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE INSERT, DELETE, TRUNCATE ON TABLE public.parcelas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parcelas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parcelas_servico FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.parcelas_servico FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.estoque_tecido_baixas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.estoque_tecido_baixas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_aviamento_itens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_aviamento_itens FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_etiqueta_itens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_etiqueta_itens FROM anon;
GRANT UPDATE (data_vencimento, status, data_pagamento, comprovante_url) ON TABLE public.parcelas_servico TO authenticated;

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
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's2_grants: pos-condicao falhou: % ainda escreve em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF r.papel = 'authenticated' AND NOT has_table_privilege('authenticated', to_regclass('public.' || r.t), 'SELECT') THEN
      RAISE EXCEPTION 's2_grants: pos-condicao falhou: authenticated perdeu o SELECT de %', r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege('service_role', to_regclass('public.' || r.t), 'INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 's2_grants: pos-condicao falhou: service_role perdeu escrita em %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('parcelas'), ('parcelas_servico')) AS x(t) LOOP
    IF EXISTS (SELECT 1 FROM unnest(ARRAY['data_vencimento', 'status', 'data_pagamento', 'comprovante_url']) col
                WHERE NOT has_column_privilege('authenticated', to_regclass('public.' || r.t), col, 'UPDATE')) THEN
      RAISE EXCEPTION 's2_grants: pos-condicao falhou: authenticated sem UPDATE nas 4 colunas de %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM (VALUES
      ('parcelas', 'valor'),
      ('parcelas', 'numero_parcela'),
      ('parcelas', 'vencimento_manual'),
      ('parcelas', 'tenant_id'),
      ('parcelas', 'oc_tecido_id'),
      ('parcelas_servico', 'valor_pago'),
      ('parcelas_servico', 'numero_parcela'),
      ('parcelas_servico', 'vencimento_manual'),
      ('parcelas_servico', 'tenant_id'),
      ('parcelas_servico', 'producao_terceirizado_id')
    ) AS x(t, col) WHERE has_column_privilege('authenticated', to_regclass('public.' || x.t), x.col, 'UPDATE')) THEN
    RAISE EXCEPTION 's2_grants: pos-condicao falhou: authenticated ainda muda coluna derivada de parcela' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
