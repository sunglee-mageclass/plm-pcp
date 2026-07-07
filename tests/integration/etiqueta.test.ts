import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, hasDb } from "./db";

// Índice único normalizado: nome de etiqueta é único por loja ignorando maiúsculas e espaços.
// Roda em txn com ROLLBACK.
describe.skipIf(!hasDb)("Etiquetas — nome único normalizado", () => {
  it("bloqueia nome igual (case/espaço) e permite nome diferente", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`insert into etiquetas (nome) values ('ETQ-UNIQ')`);
      // nome diferente -> ok (feito antes do bloqueio, que aborta a txn)
      await c.query(`insert into etiquetas (nome) values ('ETQ-OUTRA')`);
      // mesmo nome com case/espaço diferente -> BLOQUEIA (última asserção)
      await expect(
        c.query(`insert into etiquetas (nome) values ('  etq-uniq ')`),
      ).rejects.toThrow();
    });
  });
});
