import { describe, expect, it } from "vitest";
import {
  fatorCustoInsumo,
  gradeMapa,
  gradeTotal,
  insumoSemTamanho,
  pecasDoInsumo,
  rotuloTamanho,
  tamanhoEfetivoInsumo,
  tamanhoForaDaGrade,
} from "../../src/lib/insumo-tamanho";
import { CASOS_INSUMO_TAMANHO } from "../fixtures/insumo-tamanho-casos";

describe("insumo-tamanho: fixture anti-drift (espelho do SQL)", () => {
  it("a fixture tem pelo menos 12 casos", () => {
    expect(CASOS_INSUMO_TAMANHO.length).toBeGreaterThanOrEqual(12);
  });

  for (const c of CASOS_INSUMO_TAMANHO) {
    it(c.nome, () => {
      const efetivo = tamanhoEfetivoInsumo(c.info);
      const mapa = gradeMapa(c.linhas);
      const total = gradeTotal(c.linhas);
      expect(efetivo).toBe(c.esperado.efetivo);
      expect(pecasDoInsumo(efetivo, mapa, total)).toBeCloseTo(c.esperado.pecas, 4);
      expect(fatorCustoInsumo(efetivo, mapa, total)).toBeCloseTo(c.esperado.fator, 4);
      expect(tamanhoForaDaGrade(efetivo, mapa, total)).toBe(c.esperado.fora);
    });
  }
});

describe("insumo-tamanho: funcoes soltas", () => {
  it("insumoSemTamanho: 'nenhum' ou nenhuma variante com tamanho (trim)", () => {
    expect(insumoSemTamanho("nenhum", [{ tamanho: "M" }])).toBe(true);
    expect(insumoSemTamanho("letra", [{ tamanho: "M" }])).toBe(false);
    expect(insumoSemTamanho("letra", [{ tamanho: " " }, { tamanho: null }])).toBe(true);
    expect(insumoSemTamanho(null, [])).toBe(true);
  });

  it("gradeMapa soma por tamanho e so aceita numero >= 0 (regex do SQL)", () => {
    expect(
      gradeMapa([
        { grades: { a: 1, b: "2.5", c: "x", d: -1, e: null, f: true, g: "1e3" }, grade_total: 5 },
        { grades: { a: 2 }, grade_total: 2 },
      ]),
    ).toEqual({ a: 3, b: 2.5 });
  });

  it("gradeTotal soma grade_total tratando null como 0", () => {
    expect(gradeTotal([{ grades: null, grade_total: 4 }, { grades: null, grade_total: null }])).toBe(4);
  });

  it("rotuloTamanho: '40|M' -> 'M · 40' (igual ao fmtTamInsumo da aba Estoque)", () => {
    expect(rotuloTamanho("40|M")).toBe("M · 40");
    expect(rotuloTamanho("UN")).toBe("UN");
  });
});
