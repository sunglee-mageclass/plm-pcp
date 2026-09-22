import { describe, it, expect } from "vitest";
import { parseNumeroBR } from "@/lib/import/parse";

// Bugs #2/#4/#5: o parser antigo fazia replace(/\./g,"") e destruía o ponto decimal que o
// SheetJS (raw:false) entrega ("2.34" → 234). Agora distingue vírgula BR de ponto decimal.
describe("parseNumeroBR — vírgula BR + ponto decimal do SheetJS", () => {
  it("ponto decimal do SheetJS (sem vírgula) é preservado", () => {
    expect(parseNumeroBR("2.34")).toBe(2.34);   // bug #2 (rendimento) — era 234
    expect(parseNumeroBR("3.24")).toBe(3.24);   // bug #4 (preço aviamento) — era 324
    expect(parseNumeroBR("0.25")).toBe(0.25);   // bug #5 (preço insumo) — era 25
    expect(parseNumeroBR("1000.5")).toBe(1000.5);
  });

  it("vírgula BR é o separador decimal; pontos = milhar", () => {
    expect(parseNumeroBR("2,34")).toBe(2.34);
    expect(parseNumeroBR("0,25")).toBe(0.25);
    expect(parseNumeroBR("1.234,56")).toBe(1234.56);
    expect(parseNumeroBR("1.000.000,00")).toBe(1000000);
  });

  it("inteiro sem separador", () => {
    expect(parseNumeroBR("60")).toBe(60);
    expect(parseNumeroBR("324")).toBe(324);
  });

  it("aceita number direto (idempotente)", () => {
    expect(parseNumeroBR(2.34)).toBe(2.34);
    expect(parseNumeroBR(60)).toBe(60);
  });

  it("vazio / não-numérico → null", () => {
    expect(parseNumeroBR("")).toBeNull();
    expect(parseNumeroBR("   ")).toBeNull();
    expect(parseNumeroBR(null)).toBeNull();
    expect(parseNumeroBR(undefined)).toBeNull();
    expect(parseNumeroBR("abc")).toBeNull();
  });

  it("espaços ao redor são tolerados", () => {
    expect(parseNumeroBR("  2,34 ")).toBe(2.34);
    expect(parseNumeroBR(" 2.34")).toBe(2.34);
  });
});
