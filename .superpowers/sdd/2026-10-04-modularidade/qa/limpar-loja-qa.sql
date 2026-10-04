BEGIN;
-- ============================================================================================================================
-- T0 Modularidade: APAGA tudo o que loja-qa.sql criou (loja de QA, os 2 usuarios, dados e linhas de auditoria da loja).
-- Mexe SO no tenant fixo 0a0d1000-...-a001 e nos 2 e-mails qa-mod-*@local.test. Nunca toca a Loja Teste nem outras lojas.
-- `-v dry=1` (limpar-loja-qa.sh --dry-run): faz tudo e termina em ROLLBACK (nada e apagado).
-- ============================================================================================================================
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $g$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7688706257618321447
     OR current_setting('shared_preload_libraries') LIKE '%supautils%' THEN
    RAISE EXCEPTION 'loja_qa: banco nao e a copia local';
  END IF;
END
$g$;

DO $l$
DECLARE
  v_loja constant uuid := '0a0d1000-0000-4000-8000-00000000a001';
  r record; n bigint; v_resto text := '';
BEGIN
  -- Seguranca: so segue se a loja for mesmo a de QA (nome) ou se ja nao existir (reexecucao).
  IF EXISTS (SELECT 1 FROM public.tenants WHERE id = v_loja AND nome <> 'QA Modularidade (local)') THEN
    RAISE EXCEPTION 'loja_qa: o tenant fixo nao e a loja de QA';
  END IF;

  -- 1) Os logins PRIMEIRO, ainda com os gatilhos/FKs ligados: auth.users leva, por cascata, auth.identities, sessoes, tokens,
  --    public.users, user_roles e user_permissions. (O _wipe_tenant_core liga session_replication_role=replica ate o fim da
  --    transacao: depois dele os DELETEs nao cascateiam.)
  DELETE FROM auth.users WHERE email IN ('qa-mod-comum@local.test', 'qa-mod-admin@local.test');

  -- 2) A propria ferramenta de reset da loja (apaga filhas do BOM/CAD/OC, todas as tabelas com tenant_id e, com _full, tambem
  --    users/user_roles/user_permissions/tenant_config da loja). Em modo replica: nao dispara gatilhos (sem auditoria).
  PERFORM public._wipe_tenant_core(v_loja, true);

  -- 3) A loja em si.
  DELETE FROM public.tenants WHERE id = v_loja;

  -- 4) Os DELETEs do passo 1 dispararam a auditoria (audit_users...) antes do wipe, e o wipe ja apaga o audit_log da loja; esta
  --    passada garante o que sobrar com o tenant da QA.
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
           WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relname = 'audit_log' LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', r.relname) USING v_loja;
  END LOOP;

  -- 5) Pos-condicao: 0 linhas com tenant_id = loja de QA em QUALQUER tabela de public; 0 usuarios/identidades da QA.
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
           WHERE ns.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = $1', r.relname) INTO n USING v_loja;
    IF n > 0 THEN v_resto := v_resto || r.relname || '=' || n || ' '; END IF;
  END LOOP;
  IF v_resto <> '' THEN
    RAISE EXCEPTION 'loja_qa: sobrou linha com o tenant da QA: %', v_resto;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE email IN ('qa-mod-comum@local.test', 'qa-mod-admin@local.test'))
     OR EXISTS (SELECT 1 FROM auth.identities WHERE email IN ('qa-mod-comum@local.test', 'qa-mod-admin@local.test'))
     OR EXISTS (SELECT 1 FROM public.users WHERE email IN ('qa-mod-comum@local.test', 'qa-mod-admin@local.test')) THEN
    RAISE EXCEPTION 'loja_qa: sobrou usuario da QA';
  END IF;
  RAISE NOTICE 'loja_qa: limpeza conferida (0 linhas com o tenant da QA)';
END
$l$;

\if :dry
ROLLBACK;
\echo 'loja_qa: --dry-run, nada foi apagado (ROLLBACK)'
\else
COMMIT;
\endif
