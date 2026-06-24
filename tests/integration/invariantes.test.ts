import { describe, it, expect } from "vitest";
import { hasDb, withTx, um } from "./db";

// Invariantes de dados verificados sobre o banco real (somente leitura, em txn).
// Rodam como dono (sem RLS) com filtro de tenant explícito no SQL.
describe.skipIf(!hasDb)("invariantes — dinheiro e isolamento", () => {
  it("parcelas a pagar: Σ(valor) == valor_real_total de cada OC de tecido recebida", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c,
        `select count(*) as n from (
           select oc.id, oc.valor_real_total vr, coalesce(sum(p.valor),0) sp
           from ocs_tecido oc
           left join parcelas p on p.oc_tecido_id = oc.id
           where oc.status = 'recebido'
           group by oc.id, oc.valor_real_total
           having abs(coalesce(oc.valor_real_total,0) - coalesce(sum(p.valor),0)) > 0.01
         ) v`,
      );
      expect(Number(r.n)).toBe(0);
    });
  });

  it("nenhuma parcela pertence a tenant diferente da sua OC (sem vazamento)", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c,
        `select count(*) as n from parcelas p
           join ocs_tecido oc on oc.id = p.oc_tecido_id
           where p.tenant_id <> oc.tenant_id`,
      );
      expect(Number(r.n)).toBe(0);
    });
  });

  it("nenhuma parcela paga sem data de pagamento registrada", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c,
        `select count(*) as n from parcelas where status = 'pago' and data_pagamento is null`,
      );
      expect(Number(r.n)).toBe(0);
    });
  });
});
