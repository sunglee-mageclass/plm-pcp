-- Reforço de segurança — sub-release S3a ("Dinheiro, OCs e estoque de OC"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar-s3a.mjs (nunca editar à mão).
-- Desenho: .superpowers/sdd/2026-10-03-reforco-seguranca/s3-desenho.md (§1, §2.1-2.3, §3, §6 S3a); plano: plan.md (P-231 = D2 A).
-- Escrita direta do cliente nas OCs (§1.3/§1.4): ocs_tecido, ocs_tecido_itens (adiado da S2), ocs_aviamento e ocs_etiqueta
-- perdem INSERT/UPDATE/TRUNCATE (e DELETE, salvo aviamento/insumo, cuja lista exclui a OC encomendada) e ganham UPDATE so nas
-- colunas que a tela grava: tecido = nfs, recebimento_responsavel_id/_nome, rolo_codigo, numero_pedido, rolo_rua,
-- rolo_prateleira; itens = cq_ok, cq_observacao, cq_alerta_status, cancelado; aviamento = nfs; insumo = data_nota_entrada.
-- N8: valor_real_total/status/data_nota_entrada (tecido e aviamento) so pelas RPCs. ocs_p_acabado, ocs_importado,
-- ocs_importado_etapas e as 4 ordens_saida_* (a tela so grava por RPC) perdem I/U/D/T. anon perde I/U/D/T nas 11. SELECT fica.
-- Todas as escritas do servidor sao SECURITY DEFINER (owner postgres); CASCADE de FK roda como o dono da tabela.
-- Trava: GRANT/REVOKE de tabela = catálogo (pg_class.relacl/pg_attribute.attacl) — medido na cópia (pg_locks em txn
-- revertida, seg-s3a.test.ts): nenhuma trava acima de AccessShare em tabela de negócio, nada de auth/storage. Sem DROP.
-- Idempotente (a guarda aceita o estado de antes OU o de depois).
-- Volta: supabase/rollback/20261101110000_seg_s3a_grants_oc_down.sql (LIFO: 20261101120000_down → 110000_down → 100000_down, ANTES dos inversos da S2/S1 e de
-- releases anteriores que guardam por md5 as mesmas funções — ver s3a-report.md, seção "Cadeia md5").
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
    RAISE EXCEPTION 's3a_grants: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
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
    RAISE EXCEPTION 's3a_grants: tabela ausente' USING ERRCODE = 'P0001';
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
      RAISE EXCEPTION 's3a_grants: ACL inesperada em % (relacl %, colunas %) - confira o Passo 0; nada foi mudado', r.t, v_acl, v_cols
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido_itens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_tecido_itens FROM anon;
REVOKE INSERT, UPDATE, TRUNCATE ON TABLE public.ocs_aviamento FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_aviamento FROM anon;
REVOKE INSERT, UPDATE, TRUNCATE ON TABLE public.ocs_etiqueta FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_etiqueta FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_p_acabado FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_p_acabado FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado_etapas FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado_etapas FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido_itens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_tecido_itens FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento_itens FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ordens_saida_aviamento_itens FROM anon;
GRANT UPDATE (numero_pedido, rolo_codigo, rolo_rua, rolo_prateleira, nfs, recebimento_responsavel_id, recebimento_responsavel_nome) ON TABLE public.ocs_tecido TO authenticated;
GRANT UPDATE (cancelado, cq_observacao, cq_ok, cq_alerta_status) ON TABLE public.ocs_tecido_itens TO authenticated;
GRANT UPDATE (nfs) ON TABLE public.ocs_aviamento TO authenticated;
GRANT UPDATE (data_nota_entrada) ON TABLE public.ocs_etiqueta TO authenticated;

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
    IF EXISTS (SELECT 1 FROM unnest(r.privs) p WHERE has_table_privilege(r.papel, to_regclass('public.' || r.t), p)) THEN
      RAISE EXCEPTION 's3a_grants: pos-condicao falhou: % ainda tem privilegio revogado em %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege(r.papel, to_regclass('public.' || r.t), 'SELECT') THEN
      RAISE EXCEPTION 's3a_grants: pos-condicao falhou: % perdeu o SELECT de %', r.papel, r.t USING ERRCODE = 'P0001';
    END IF;
    IF NOT has_table_privilege('service_role', to_regclass('public.' || r.t), 'INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 's3a_grants: pos-condicao falhou: service_role perdeu escrita em %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- UPDATE do cliente: EXATAMENTE as colunas que a tela grava (nenhuma a mais, nenhuma a menos); anon nenhuma
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido', ARRAY['numero_pedido', 'rolo_codigo', 'rolo_rua', 'rolo_prateleira', 'nfs', 'recebimento_responsavel_id', 'recebimento_responsavel_nome']::text[]),
      ('ocs_tecido_itens', ARRAY['cancelado', 'cq_observacao', 'cq_ok', 'cq_alerta_status']::text[]),
      ('ocs_aviamento', ARRAY['nfs']::text[]),
      ('ocs_etiqueta', ARRAY['data_nota_entrada']::text[]),
      ('ocs_p_acabado', ARRAY[]::text[]),
      ('ocs_importado', ARRAY[]::text[]),
      ('ocs_importado_etapas', ARRAY[]::text[]),
      ('ordens_saida_tecido', ARRAY[]::text[]),
      ('ordens_saida_tecido_itens', ARRAY[]::text[]),
      ('ordens_saida_aviamento', ARRAY[]::text[]),
      ('ordens_saida_aviamento_itens', ARRAY[]::text[])
    ) AS x(t, cols) LOOP
    SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v FROM pg_attribute a
     WHERE a.attrelid = to_regclass('public.' || r.t) AND a.attnum > 0 AND NOT a.attisdropped
       AND has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE');
    IF coalesce(v, '') <> coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM unnest(r.cols) x), '') THEN
      RAISE EXCEPTION 's3a_grants: pos-condicao falhou: UPDATE de authenticated em % = % (esperado %)', r.t, v, r.cols USING ERRCODE = 'P0001';
    END IF;
    IF has_any_column_privilege('anon', to_regclass('public.' || r.t), 'UPDATE, INSERT') THEN
      RAISE EXCEPTION 's3a_grants: pos-condicao falhou: anon ainda escreve coluna de %', r.t USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'public.ocs_aviamento', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.ocs_etiqueta', 'DELETE') THEN
    RAISE EXCEPTION 's3a_grants: pos-condicao falhou: authenticated perdeu o DELETE de ocs_aviamento/ocs_etiqueta (a lista exclui OC encomendada)'
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
      ('ocs_tecido', 'valor_real_total'),
      ('ocs_tecido', 'valor_previsto_total'),
      ('ocs_tecido', 'status'),
      ('ocs_tecido', 'data_nota_entrada'),
      ('ocs_tecido', 'tenant_id'),
      ('ocs_tecido', 'rev'),
      ('ocs_tecido', 'is_rolo'),
      ('ocs_tecido_itens', 'quantidade_recebida'),
      ('ocs_tecido_itens', 'quantidade_pedida'),
      ('ocs_tecido_itens', 'preco'),
      ('ocs_tecido_itens', 'artigo_id'),
      ('ocs_tecido_itens', 'variante_tecido_id'),
      ('ocs_tecido_itens', 'oc_tecido_id'),
      ('ocs_aviamento', 'status'),
      ('ocs_aviamento', 'data_nota_entrada'),
      ('ocs_aviamento', 'tenant_id'),
      ('ocs_aviamento', 'rev'),
      ('ocs_etiqueta', 'status'),
      ('ocs_etiqueta', 'tenant_id'),
      ('ocs_etiqueta', 'rev')
    ) AS x(t, col) WHERE has_column_privilege('authenticated', to_regclass('public.' || x.t), x.col, 'UPDATE')) THEN
    RAISE EXCEPTION 's3a_grants: pos-condicao falhou: authenticated ainda muda coluna derivada de OC' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
