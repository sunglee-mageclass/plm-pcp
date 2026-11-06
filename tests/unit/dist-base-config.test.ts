// F2 Tarefa B — base automática pela config (loja × linha) no dialog "Distribuir por loja" + CONGELAMENTO.
// Helpers PUROS: `aplicarBaseConfig` (aplica a config por cima) e `devePrePreencher` (decisão do congelamento).
import { describe, it, expect } from "vitest";
import { aplicarBaseConfig, devePrePreencher, type Distribuicao } from "@/lib/distribuicao-produto";

const prop = { "40|M": 0.5, "42|G": 0.5 };
const tamanhos = ["40|M", "42|G"];

describe("aplicarBaseConfig", () => {
  it("(a) variante vazia pega a base da config em cada loja", () => {
    const out = aplicarBaseConfig({}, { L1: 40, L2: 20 }, ["L1", "L2"], prop, tamanhos);
    expect(out.L1.base).toBe(40);
    expect(out.L1.grades["40|M"]).toBe(20); // round(0.5 * 40)
    expect(out.L1.grades["42|G"]).toBe(20);
    expect(out.L2.base).toBe(20);
    expect(out.L2.grades["40|M"]).toBe(10); // round(0.5 * 20)
  });

  it("(d) loja sem config -> base 0 (linha nao materializa; sem NaN)", () => {
    const out = aplicarBaseConfig({}, { L1: 30 }, ["L1", "L2"], prop, tamanhos);
    expect(out.L1.base).toBe(30);
    expect(out.L2).toBeUndefined(); // base 0 e sem manual -> linha nao existe
  });

  it("(d) linha SEM config nenhuma -> base 0 em todas, sem erro/NaN", () => {
    const out = aplicarBaseConfig({}, {}, ["L1", "L2"], prop, tamanhos);
    expect(out.L1).toBeUndefined();
    expect(out.L2).toBeUndefined();
    expect(Object.keys(out).length).toBe(0);
  });

  it("(c) recalcular pela config SOBRESCREVE a base mas mantem a celula manual", () => {
    // L1 tinha base 10 com 40|M corrigido a mao para 7
    let d: Distribuicao = { L1: { base: 10, grades: { "40|M": 7, "42|G": 5 }, manuais: ["40|M"] } };
    d = aplicarBaseConfig(d, { L1: 40 }, ["L1"], prop, tamanhos);
    expect(d.L1.base).toBe(40);
    expect(d.L1.grades["40|M"]).toBe(7); // manual fica
    expect(d.L1.grades["42|G"]).toBe(20); // recalculado = round(0.5 * 40)
    expect(d.L1.manuais).toContain("40|M");
  });

  it("config com valor nao-numerico/undefined vira base 0 (sem NaN)", () => {
    const out = aplicarBaseConfig({}, { L1: NaN as unknown as number, L2: undefined as unknown as number }, ["L1", "L2"], prop, tamanhos);
    expect(out.L1).toBeUndefined();
    expect(out.L2).toBeUndefined();
  });
});

describe("devePrePreencher (CONGELAMENTO)", () => {
  it("(b) variante SALVA (com distribuicao) NAO pre-preenche -> CONGELADA", () => {
    expect(devePrePreencher({ L1: { base: 10, grades: {}, manuais: [] } })).toBe(false);
  });

  it("variante VAZIA pre-preenche", () => {
    expect(devePrePreencher({})).toBe(true);
    expect(devePrePreencher(null)).toBe(true);
    expect(devePrePreencher(undefined)).toBe(true);
  });
});
