import { describe, it, expect } from "vitest";
import { fmtNum, brl, fmtNumEdit } from "@/lib/format";

// Normaliza o espaço (toLocaleString de moeda usa NBSP entre "R$" e o número).
const norm = (s: string) => s.replace(/ /g, " ");

describe("format — fmtNum (pt-BR, sempre 2 casas)", () => {
  it("sempre 2 casas decimais", () => {
    expect(fmtNum(3.8)).toBe("3,80");
    expect(fmtNum(0)).toBe("0,00");
  });
  it("milhar com ponto, decimal com vírgula", () => {
    expect(fmtNum(1234.5)).toBe("1.234,50");
  });
  it("vazio/null/NaN → 0,00", () => {
    expect(fmtNum("")).toBe("0,00");
    expect(fmtNum(null)).toBe("0,00");
    expect(fmtNum(undefined)).toBe("0,00");
    expect(fmtNum("abc")).toBe("0,00");
  });
  it("aceita string numérica", () => {
    expect(fmtNum("1234.5")).toBe("1.234,50");
  });
});

describe("format — brl (moeda)", () => {
  it("formata R$ pt-BR", () => {
    expect(norm(brl(1234.5))).toBe("R$ 1.234,50");
    expect(norm(brl(0))).toBe("R$ 0,00");
  });
  it("null vira zero", () => {
    expect(norm(brl(null))).toBe("R$ 0,00");
  });
});

describe("format — fmtNumEdit (até 4 casas, vazio preserva vazio)", () => {
  it("mínimo 2 casas", () => {
    expect(fmtNumEdit(3.8)).toBe("3,80");
  });
  it("preserva precisão alta (até 4 casas)", () => {
    expect(fmtNumEdit(0.1234)).toBe("0,1234");
  });
  it("vazio continua vazio (não vira 0)", () => {
    expect(fmtNumEdit("")).toBe("");
    expect(fmtNumEdit(null)).toBe("");
    expect(fmtNumEdit(undefined)).toBe("");
  });
});
