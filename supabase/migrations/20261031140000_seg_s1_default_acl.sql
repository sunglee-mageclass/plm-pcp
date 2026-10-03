-- Reforço de segurança — Release S1 ("Fechar portas sem travar nada"). GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- PRIV-2: o pg_default_acl do postgres em public dava arwdDxtm (tabelas), rwU (sequencias) e X (funcoes) ao anon e
-- TRUNCATE/REFERENCES/TRIGGER ao authenticated a CADA objeto novo; e o padrao global dava EXECUTE a PUBLIC em toda funcao
-- nova (foi assim que nasceram os 56 do ANON-1). Agora objeto NOVO criado pelo postgres: sem anon, authenticated sem
-- D/x/t, funcao sem PUBLIC (authenticated e service_role seguem com X pela entrada de public). Objetos EXISTENTES: intocados
-- (S5). Nao mexe nas entradas do supabase_admin (o postgres nao e membro dele) nem no schema storage.
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / REVOKE-GRANT EXECUTE / ALTER DEFAULT PRIVILEGES): nenhuma tabela de
-- negócio, nada de auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY. Idempotente (guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261031140000_seg_s1_default_acl_down.sql (LIFO: os inversos da S1 rodam do mais novo ao mais antigo, ANTES dos inversos de releases
-- anteriores que guardam por md5 as mesmas funções — ver o relatório s1-report.md, seção "Cadeia md5").
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 's1_priv2: papeis anon/authenticated/service_role ausentes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND x.grantee = 'anon'::regrole) THEN
    RAISE EXCEPTION 's1_priv2: pos-condicao: anon ainda no default ACL do postgres em public' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND x.grantee = 'authenticated'::regrole AND x.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')) THEN
    RAISE EXCEPTION 's1_priv2: pos-condicao: authenticated ainda com TRUNCATE/REFERENCES/TRIGGER no default de tabelas' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_default_acl d WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     OR EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f' AND x.grantee = 0) THEN
    RAISE EXCEPTION 's1_priv2: pos-condicao: funcao nova do postgres ainda nasce com EXECUTE para PUBLIC' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'f' AND x.grantee = 'authenticated'::regrole AND x.privilege_type IN ('EXECUTE')) OR NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'f' AND x.grantee = 'service_role'::regrole AND x.privilege_type IN ('EXECUTE')) OR NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND x.grantee = 'authenticated'::regrole AND x.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) THEN
    RAISE EXCEPTION 's1_priv2: pos-condicao: authenticated/service_role perderam o default que deviam manter' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
