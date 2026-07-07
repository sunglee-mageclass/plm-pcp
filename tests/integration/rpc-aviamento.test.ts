import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, hasDb, TENANT_TESTE } from "./db";

// Índice único: código de aviamento pode repetir entre fornecedores diferentes, mas não no mesmo
// fornecedor (nem "sem fornecedor" repetido). Roda em txn com ROLLBACK.
describe.skipIf(!hasDb)("Aviamentos — código único por fornecedor", () => {
  it("permite mesmo código em fornecedor diferente; bloqueia no mesmo fornecedor", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await c.query(`select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);

      // base: código sem fornecedor
      await c.query(`insert into aviamentos (codigo_nome, empresa_id) values ('AV-UNIQ', null)`);

      // mesmo código, fornecedor DIFERENTE -> permite (feito antes do bloqueio, que aborta a txn)
      if (emp.rows[0]) {
        await c.query(`insert into aviamentos (codigo_nome, empresa_id) values ('AV-UNIQ', $1)`, [emp.rows[0].id]);
      }

      // mesmo código + mesmo fornecedor (null), com case diferente -> BLOQUEIA (última asserção)
      await expect(
        c.query(`insert into aviamentos (codigo_nome, empresa_id) values ('av-uniq', null)`),
      ).rejects.toThrow();
    });
  });
});
