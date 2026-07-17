import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

const ligarOtb = (c: any) =>
  c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);

describe.skipIf(!hasDb)("OTB Simulador — tabelas", () => {
  it("insere simulação e o tenant vem por trigger (RLS)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SIM','rascunho') returning id`, []);
      const sim = await um<{ id: string; tenant_id: string }>(
        c, `insert into otb_simulacoes (colecao_id, nome) values ($1,'Cenário 1') returning id, tenant_id`, [col.id]);
      expect(sim.tenant_id).toBe(TENANT_TESTE);
      const un = await um<{ tenant_id: string }>(
        c, `insert into otb_simulacao_unidades (simulacao_id, subcolecao_id) values ($1, null) returning tenant_id`, [sim.id]);
      expect(un.tenant_id).toBe(TENANT_TESTE);
    });
  });
});
