import { describe, it, expect } from "vitest";
import { brToIso, maskBr, processarDigitacao } from "@/lib/date-field";

describe("DateField: validação", () => {
  it("aceita data completa válida", () => expect(brToIso("15/07/2026")).toBe("2026-07-15"));
  it("rejeita 31/02", () => expect(brToIso("31/02/2026")).toBeNull());
  it("rejeita ano fora de 1900-2100", () => {
    expect(brToIso("11/10/7202")).toBeNull();
    expect(brToIso("01/01/1899")).toBeNull();
    expect(brToIso("01/01/2101")).toBeNull();
    expect(brToIso("01/01/1900")).toBe("1900-01-01");
    expect(brToIso("31/12/2100")).toBe("2100-12-31");
  });
  it("respeita min/max", () => {
    expect(brToIso("14/07/2026", { min: "2026-07-15" })).toBeNull();
    expect(brToIso("15/07/2026", { min: "2026-07-15" })).toBe("2026-07-15");
    expect(brToIso("16/07/2026", { max: "2026-07-15" })).toBeNull();
  });
});

describe("DateField: digitação", () => {
  it("digitar no meio de data completa NÃO emite data acidental", () => {
    const r = processarDigitacao("115/07/2026", 2);
    expect(r.iso).toBeNull();
    expect(r.texto).toBe("11/50/7202");
  });
  it("sequência de dígitos pura 15072026 emite 2026-07-15", () => {
    expect(processarDigitacao("15072026", 8).iso).toBe("2026-07-15");
  });
  it("cola 15/07/2026", () => {
    const r = processarDigitacao("15/07/2026", 10);
    expect(r.iso).toBe("2026-07-15");
    expect(r.texto).toBe("15/07/2026");
    expect(r.cursor).toBe(10);
  });
  it("ano fora do intervalo não emite", () =>
    expect(processarDigitacao("11/10/7202", 10).iso).toBeNull());
  it("incompleto não emite; vazio emite ''", () => {
    expect(processarDigitacao("15/07/20", 8).iso).toBeNull();
    expect(processarDigitacao("", 0).iso).toBe("");
  });
  it("mantém o cursor ao lado do mesmo dígito (inserção no meio)", () => {
    const r = processarDigitacao("195/07", 2);
    expect(r.texto).toBe("19/50/7");
    expect(r.cursor).toBe(2);
  });
  it("cursor pula a barra injetada ao digitar o 3º dígito", () => {
    const r = processarDigitacao("152", 3);
    expect(r.texto).toBe("15/2");
    expect(r.cursor).toBe(4);
  });
  it("cursor no início", () => expect(processarDigitacao("9", 0).cursor).toBe(0));
  it("maskBr", () => expect(maskBr("15072026")).toBe("15/07/2026"));
});
