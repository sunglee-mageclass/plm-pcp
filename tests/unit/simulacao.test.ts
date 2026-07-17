import { describe, it, expect } from "vitest";
import { splitEven, metragemDisponivel, pecasLinha, demandaLinha, saldo, distribuirNasSemanas } from "@/lib/simulacao";

describe("simulacao — cálculo puro", () => {
  it("splitEven reparte o resto nas primeiras", () => {
    expect(splitEven(13, 5)).toEqual([3, 3, 3, 2, 2]);
    expect(splitEven(10, 5)).toEqual([2, 2, 2, 2, 2]);
    expect(splitEven(3, 0)).toEqual([]);
    expect(splitEven(0, 3)).toEqual([0, 0, 0]);
  });
  it("metragem: kg converte por rendimento; metro é direto", () => {
    expect(metragemDisponivel("kg", 100, 4)).toBe(400);
    expect(metragemDisponivel("metro", 250, 4)).toBe(250);
    expect(metragemDisponivel("kg", 100, null)).toBe(0);
  });
  it("peças e demanda", () => {
    expect(pecasLinha(8, 3)).toBe(24);
    // 2 modelos × 24 peças × consumos 1,2 e 1,5 → 24*1.2 + 24*1.5
    expect(demandaLinha(8, 3, [1.2, 1.5])).toBeCloseTo(24 * 1.2 + 24 * 1.5, 5);
  });
  it("saldo e distribuição", () => {
    expect(saldo(900, 172.8)).toBeCloseTo(727.2, 5);
    expect(distribuirNasSemanas(13, [1, 2, 3, 4, 5])).toEqual({ "1": 3, "2": 3, "3": 3, "4": 2, "5": 2 });
    expect(distribuirNasSemanas(5, [])).toEqual({});
  });
});
