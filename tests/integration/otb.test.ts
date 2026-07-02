import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("OTB — coleções", () => {
  it("insere coleção e semana no tenant e lê de volta (RLS)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const col = await um<{ id: string; tenant_id: string; status: string }>(
        c,
        `insert into public.colecoes (nome, orcamento) values ($1, $2) returning id, tenant_id, status`,
        ["Verão Teste OTB", 100000],
      );
      expect(col.tenant_id).toBe(TENANT_TESTE);
      expect(col.status).toBe("rascunho");
      await c.query(
        `insert into public.colecao_semanas (colecao_id, semana, qtd_planejada) values ($1,'1',10)`,
        [col.id],
      );
      const wk = await um<{ n: string }>(c, `select count(*)::text n from public.colecao_semanas where colecao_id=$1`, [col.id]);
      expect(wk.n).toBe("1");
    });
  });
});
