import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Regressão da auditoria de reserva/baixa (jul/2026):
//
// (Q3) `estoque_tecido_por_artigo` deve reconciliar EXATAMENTE com o canônico
//   `_estoque_tecido_core`.
//
// ⚠️ O teste (Q2) "zerar um lote mantém a reserva" foi REMOVIDO (set/2026): a flag
//   `ocs_tecido_itens.estoque_zerado` foi APOSENTADA em jul/2026 (migração 20260727000000) —
//   virou vestígio inerte (sempre false, sem leitor no `_estoque_tecido_core`). Marcar
//   `estoque_zerado=true` não tem mais efeito, então o cenário não existe: "encerrar" um lote
//   hoje é write-off por baixa de AJUSTE no ledger, não uma flag. Ver memória project_estoque_calculo.
describe.skipIf(!hasDb)("estoque: consistência por-artigo × canônico", () => {
  it("estoque_tecido_por_artigo reconcilia com o canônico", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);

      const rpcTotal = Number(
        (
          await um<{ t: string }>(
            c,
            `select coalesce(sum((x->>'fisico_m')::numeric),0) t
               from jsonb_array_elements(public.estoque_tecido_por_artigo()) x`,
          )
        )?.t ?? 0,
      );
      const coreTotal = Number(
        (await um<{ t: string }>(c, `select coalesce(sum(fisico),0) t from public._estoque_tecido_core($1)`, [TENANT_TESTE]))?.t ?? 0,
      );

      expect(rpcTotal).toBeCloseTo(coreTotal, 4);
    });
  });
});
