import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Direcionamento multi-lojas — tudo em txn revertida (BEGIN…ROLLBACK): nada é gravado.
describe.skipIf(!hasDb)("Multi-lojas fase 1 — cadastro lojas_direcionamento", () => {
  it("todo tenant tem E-commerce (default, ordem 1) e Loja Física (ordem 2) semeadas", async () => {
    await withTx(async (c) => {
      const faltando = await um<{ n: string }>(
        c,
        `select count(*) as n from tenants t
          where not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.is_default and l.nome = 'E-commerce')
             or not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.nome = 'Loja Física')`,
      );
      expect(Number(faltando.n)).toBe(0);
      const seeds = await c.query(
        `select nome, ativo, is_default, ordem from lojas_direcionamento
          where tenant_id = $1 order by ordem`,
        [TENANT_TESTE],
      );
      expect(seeds.rows[0]).toMatchObject({ nome: "E-commerce", ativo: true, is_default: true, ordem: 1 });
      expect(seeds.rows[1]).toMatchObject({ nome: "Loja Física", ativo: true, is_default: false, ordem: 2 });
    });
  });

  it("_seed_tenant_defaults passou a semear lojas (loja nova/reset nasce com as 2)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('lojas_direcionamento' in pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("UNIQUE (tenant_id, nome) barra loja duplicada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(`insert into lojas_direcionamento (tenant_id, nome) values ($1, 'E-commerce')`, [TENANT_TESTE]),
      ).rejects.toThrow(/duplicate key|lojas_direcionamento_tenant_nome/);
    });
  });

  it("índice único parcial barra um 2º default no mesmo tenant", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(
          `insert into lojas_direcionamento (tenant_id, nome, is_default) values ($1, 'Outra Loja', true)`,
          [TENANT_TESTE],
        ),
      ).rejects.toThrow(/duplicate key|lojas_direcionamento_um_default/);
    });
  });
});
