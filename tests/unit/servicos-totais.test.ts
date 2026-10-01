import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { totaisServicos } from "@/lib/servicos-totais";

const rows = [
  { valor_parcela: 100, st: "pago" },
  { valor_parcela: "50.5", st: "vencido" },
  { valor_parcela: 20, st: "a_pagar" },
  { valor_parcela: null, st: "a_pagar" },
] as const;

describe("fin #7 totais de serviços", () => {
  it("separa pago e a pagar (só não pagas)", () => {
    const t = totaisServicos([...rows], (r) => r.st as any);
    expect(t.pago).toBe(100);
    expect(t.aPagar).toBeCloseTo(70.5);
    expect(t.total).toBeCloseTo(170.5);
  });
  it("tela e impressão usam os rótulos corretos", () => {
    const src = readFileSync("src/routes/_authenticated/financeiro.tsx", "utf8");
    expect(src).toContain("totaisServicos(");
    expect(src).not.toMatch(/Total a pagar \(parcelas\)[^\n]*brl\(total\)/);
    expect(src).not.toMatch(/label: "Total a pagar", valor: brl\(total\)/);
  });
});
