import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { CONDICAO_KEYS } from "../../src/lib/kanban-condicoes";

// ANTI-DRIFT: a RPC de avaliação (SQL) e o catálogo (TS, SSOT) precisam ter
// EXATAMENTE as mesmas chaves. Se alguém adicionar uma condição num lado e
// esquecer o outro, este teste quebra — que é o objetivo (evita revisão manual).
describe.skipIf(!hasDb)("kanban — RPC de condições × catálogo (anti-drift)", () => {
  it("avaliar_condicoes_kanban devolve exatamente as chaves de CONDICAO_KEYS", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const mrow = await um<{ id: string }>(
        c,
        `select id from modelos where tenant_id = $1 limit 1`,
        [TENANT_TESTE],
      );
      expect(mrow?.id, "precisa de ≥1 modelo na Loja Teste").toBeTruthy();
      const r = await um<{ obj: Record<string, boolean> | null }>(
        c,
        `select public.avaliar_condicoes_kanban(array[$1::uuid]) -> $2 as obj`,
        [mrow.id, mrow.id],
      );
      const rpcKeys = Object.keys(r.obj ?? {}).sort();
      const catKeys = [...CONDICAO_KEYS].sort();
      expect(rpcKeys).toEqual(catKeys);
    });
  });
});
