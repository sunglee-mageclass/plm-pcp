import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

// F3: o seletor grava empresa_id (+representante_id) em producao_terceirizados; o gatilho
// bidirecional preenche terceirizado_id a partir do espelho — sem isso a oficina SOME do ranking
// (_ranking_oficinas_core usa INNER JOIN em terceirizados). Este teste trava esse invariante.
describe.skipIf(!hasDb)("Fornecedores F3 — empresa deriva terceirizado (protege o INNER JOIN)", () => {
  it("gravar só empresa_id preenche terceirizado_id; serviço interno não deriva", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(c, `select id from cad where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const emp = await um<{ id: string; origem: string }>(
        c,
        `select id, origem_terceirizado_id as origem from empresas
         where tipo='servico' and origem_terceirizado_id is not null and tenant_id=$1 limit 1`,
        [TENANT_TESTE],
      );

      // grava SÓ empresa_id → terceirizado_id deve ser derivado do espelho
      const blk = await um<{ terceirizado_id: string | null }>(
        c,
        `insert into producao_terceirizados (cad_id, empresa_id, interno) values ($1,$2,false)
         returning terceirizado_id`,
        [cad.id, emp.id],
      );
      expect(blk.terceirizado_id).toBe(emp.origem);

      // serviço interno/PL não deriva (sem empresa/terceirizado)
      const intb = await um<{ terceirizado_id: string | null }>(
        c,
        `insert into producao_terceirizados (cad_id, empresa_id, interno) values ($1,$2,true)
         returning terceirizado_id`,
        [cad.id, emp.id],
      );
      expect(intb.terceirizado_id).toBeNull();
    });
  });
});
