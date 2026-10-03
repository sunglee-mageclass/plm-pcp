-- Inverso de supabase/migrations/20261031140000_seg_s1_default_acl.sql — GERADO por .superpowers/sdd/2026-10-03-reforco-seguranca/mig/gerar.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-03-reforco-seguranca/plan.md (§1, §2 S1, RESPOSTAS DO DONO).
-- Devolve o estado de ANTES desta migration (textos/ACL lidos da cópia 54422 = produção 03/out).
-- Trava: só catálogo (CREATE OR REPLACE FUNCTION / REVOKE-GRANT EXECUTE / ALTER DEFAULT PRIVILEGES): nenhuma tabela de
-- negócio, nada de auth/storage. Sem DROP, sem CREATE TRIGGER/POLICY. Idempotente (guarda aceita antes OU depois).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
BEGIN
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 's1_priv2_down: papeis anon/authenticated ausentes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'f' AND x.grantee = 'anon'::regrole AND x.privilege_type IN ('EXECUTE')) OR NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND x.grantee = 'anon'::regrole AND x.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))
     OR NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'S' AND x.grantee = 'anon'::regrole AND x.privilege_type IN ('USAGE')) THEN
    RAISE EXCEPTION 's1_priv2_down: pos-condicao: anon nao voltou ao default ACL do postgres em public' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(DISTINCT x.privilege_type) FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole
        AND d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r' AND x.grantee = 'authenticated'::regrole AND x.privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')) <> 3 THEN
    RAISE EXCEPTION 's1_priv2_down: pos-condicao: authenticated sem TRUNCATE/REFERENCES/TRIGGER no default de tabelas' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_default_acl d WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f')
     AND NOT EXISTS (SELECT 1 FROM pg_default_acl d, aclexplode(d.defaclacl) x WHERE d.defaclrole = 'postgres'::regrole AND d.defaclnamespace = 0 AND d.defaclobjtype = 'f' AND x.grantee = 0 AND x.privilege_type IN ('EXECUTE')) THEN
    RAISE EXCEPTION 's1_priv2_down: pos-condicao: funcao nova do postgres sem EXECUTE para PUBLIC' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;
COMMIT;
