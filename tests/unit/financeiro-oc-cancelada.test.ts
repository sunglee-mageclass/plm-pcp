import { describe, it, expect } from "vitest";
import { aplicarOcCancelada } from "@/lib/financeiro-oc-cancelada";

describe("fin #16b: OC cancelada", () => {
  const canc = new Set(["oc1"]);
  const ps = [
    { id: "a", oc_tecido_id: "oc1", status: "a_pagar", data_pagamento: null },
    { id: "b", oc_tecido_id: "oc1", status: "pago", data_pagamento: "2026-07-01" },
    { id: "c", oc_tecido_id: "oc1", status: "a_pagar", data_pagamento: "2026-07-02" },
    { id: "d", oc_tecido_id: "oc2", status: "a_pagar", data_pagamento: null },
    { id: "e", oc_tecido_id: null, status: "a_pagar", data_pagamento: null },
  ];
  const r = aplicarOcCancelada(ps, canc);
  it("esconde só a não paga da OC cancelada", () =>
    expect(r.map((p) => p.id)).toEqual(["b", "c", "d", "e"]));
  it("paga da OC cancelada ganha selo; as demais não", () => {
    expect(r.filter((p) => p.ocCancelada).map((p) => p.id)).toEqual(["b", "c"]);
  });
});
