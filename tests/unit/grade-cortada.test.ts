import { describe, it, expect } from "vitest";
import { saldoCelula, gradeRealCelula, somaCampo, CELULA_ZERO } from "@/lib/grade-cortada";

describe("grade-cortada helpers", () => {
  it("saldoCelula = cortada − recebida (pode ser negativo)", () => {
    expect(saldoCelula({ enviada: 0, cortada: 10, recebida: 4, defeito: 0 })).toBe(6);
    expect(saldoCelula({ enviada: 0, cortada: 3, recebida: 5, defeito: 0 })).toBe(-2);
  });
  it("gradeRealCelula = max(0, recebida − defeito)", () => {
    expect(gradeRealCelula({ enviada: 0, cortada: 0, recebida: 8, defeito: 3 })).toBe(5);
    expect(gradeRealCelula({ enviada: 0, cortada: 0, recebida: 2, defeito: 9 })).toBe(0);
  });
  it("somaCampo soma o campo sobre toda a grade (chave ausente = 0)", () => {
    const g = { vA: { "38|P": { cortada: 5, recebida: 2 } as any }, vB: { "40|M": { cortada: 3 } as any } };
    expect(somaCampo(g as any, "cortada")).toBe(8);
    expect(somaCampo(g as any, "recebida")).toBe(2);
  });
  it("CELULA_ZERO zera os quatro campos", () => {
    expect(CELULA_ZERO).toEqual({ enviada: 0, cortada: 0, recebida: 0, defeito: 0 });
  });
});
