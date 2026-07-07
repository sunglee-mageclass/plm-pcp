import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

// Fornecedores: producao_terceirizados grava empresa_id DIRETO (fonte única do responsável PL).
// O espelho terceirizados + a derivação terceirizado_id foram removidos (F5b); as RPCs de
// leitura (ranking/dashboard/cq) leem empresa_id. Este teste trava esse invariante.
describe.skipIf(!hasDb)("Fornecedores — producao_terceirizados grava empresa_id direto", () => {
  it("grava empresa_id no bloco de serviço externo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(c, `select id from cad where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const emp = await um<{ id: string }>(
        c,
        `select id from empresas where tipo='servico' and tenant_id=$1 limit 1`,
        [TENANT_TESTE],
      );
      const blk = await um<{ empresa_id: string | null }>(
        c,
        `insert into producao_terceirizados (cad_id, empresa_id, interno) values ($1,$2,false) returning empresa_id`,
        [cad.id, emp.id],
      );
      expect(blk.empresa_id).toBe(emp.id);
    });
  });
});
