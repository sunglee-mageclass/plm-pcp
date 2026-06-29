import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, semUsuario, um, TENANT_TESTE } from "./db";

// No banco atual TODO usuário é super_admin (é a conta do dono). Para exercitar o
// caminho "sem privilégio", usamos um UUID que não tem papel nenhum: is_super_admin()
// é false e get_user_tenant_id() cai no sentinela — exatamente o caller a ser barrado.
const SEM_PAPEL = "11111111-1111-1111-1111-111111111111";

// Espinha de segurança multi-tenant: os helpers que toda RPC usa para decidir
// tenant/role/módulo. Se algum regredir, vazamento ou bloqueio indevido aparece aqui.
describe.skipIf(!hasDb)("segurança — helpers de tenant/role/módulo", () => {
  it("get_user_tenant_id() resolve o tenant do usuário logado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const r = await um<{ tid: string }>(c, "select get_user_tenant_id() as tid");
      expect(r.tid).toBe(TENANT_TESTE);
    });
  });

  it("loja ativa → meu_tenant_ativo() = true; sentinela nil sem usuário", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ativo = await um<{ a: boolean }>(c, "select meu_tenant_ativo() as a");
      expect(ativo.a).toBe(true);
    });
    await withTx(async (c) => {
      await semUsuario(c);
      // sem usuário, get_user_tenant_id() NÃO retorna NULL — retorna o UUID sentinela nil
      const r = await um<{ tid: string }>(c, "select get_user_tenant_id() as tid");
      expect(r.tid).toBe("00000000-0000-0000-0000-000000000000");
    });
  });

  it("módulo habilitado da loja → tenant_module_enabled('producao') = true", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const r = await um<{ m: boolean }>(c, "select tenant_module_enabled('producao') as m");
      expect(r.m).toBe(true);
    });
  });

  it("caller sem privilégio NÃO consegue resetar loja (guarda de super_admin)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c, SEM_PAPEL);
      await expect(c.query("select reset_loja($1)", [TENANT_TESTE])).rejects.toThrow();
    });
  });

  it("caller sem papel NÃO é super_admin; o dono É super_admin", async () => {
    await withTx(async (c) => {
      await comoUsuario(c, SEM_PAPEL);
      const semPapel = await um<{ s: boolean }>(c, "select is_super_admin() as s");
      expect(semPapel.s).toBe(false);
    });
    await withTx(async (c) => {
      await comoUsuario(c); // USER_TESTE = conta do dono
      const dono = await um<{ s: boolean }>(c, "select is_super_admin() as s");
      expect(dono.s).toBe(true);
    });
  });

  // Bug: super_admin gravava permissões (service-role) mas NÃO as relia (RLS sem policy
  // de super_admin) → modal voltava vazio. A policy abaixo restaura a leitura/escrita.
  it("super_admin tem policy em user_permissions (bug: gravava mas não relia)", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c,
        `select count(*) as n from pg_policies
          where schemaname='public' and tablename='user_permissions'
            and policyname='super_admin_user_permissions'`,
      );
      expect(Number(r.n)).toBe(1);
    });
  });
});
