import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("Produto Acabado — códigos automáticos", () => {
  it("REF não-acessório = 2G+1C+2S + 7 díg; acessório = 2G+3CAT; nº OC usa ACE p/ grupo Acessórios", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Feminino PATest') returning id`);
      const ga = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Acessórios PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido PATest') returning id`);
      const catB = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Bolsa PATest') returning id`);
      const s1 = await um<any>(c, `insert into subcategorias1_produto (tenant_id, nome, categoria_id) values ('${TENANT_TESTE}','Estampado PATest','${cat.id}') returning id`);
      const p1 = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id, subcategoria1_id)
        values ('${TENANT_TESTE}','Vestido X','${g.id}','${cat.id}','${s1.id}') returning ref`);
      expect(p1.ref).toMatch(/^FEVES\d{7}$/);
      const p2 = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id)
        values ('${TENANT_TESTE}','Bolsa Y','${ga.id}','${catB.id}') returning ref`);
      expect(p2.ref).toMatch(/^ACBOL\d{7}$/);
      const emp = await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}','Bella Couros PATest','material') returning id`);
      const oc = await um<any>(c, `insert into ocs_p_acabado (tenant_id, nome_produto, grupo_id, categoria_id, empresa_id)
        values ('${TENANT_TESTE}','Bolsa Y','${ga.id}','${catB.id}','${emp.id}') returning numero`);
      expect(oc.numero).toMatch(/^BELACE-\d{5}$/);
    });
  });
  it("vínculo único: 2ª OC no mesmo produto dá P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem2 PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Calça PATest') returning id`);
      const p = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id) values ('${TENANT_TESTE}','P','${g.id}','${cat.id}') returning id`);
      await c.query(`insert into ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) values ('${TENANT_TESTE}','P','${p.id}')`);
      await expect(c.query(`insert into ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) values ('${TENANT_TESTE}','P','${p.id}')`)).rejects.toThrow(/vinculada/);
    });
  });
});
