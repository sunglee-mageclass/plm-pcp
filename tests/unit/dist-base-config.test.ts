// F2 Tarefa B — base automática pela config (loja × linha) no dialog "Distribuir por loja" + CONGELAMENTO.
// Helpers PUROS: `aplicarBaseConfig` (aplica a config por cima) e `devePrePreencher` (decisão do congelamento).
import { describe, it, expect } from "vitest";
import { aplicarBaseConfig, baseDaCor, aplicarConfigPorCor, devePrePreencher, type Distribuicao } from "@/lib/distribuicao-produto";

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

// F2 B' — contrato novo da RPC: { "<quantidade>": { "<loja_id>": base } }. Cada COR casa pela SUA quantidade.
describe("baseDaCor (casa a cor pela quantidade dela)", () => {
  const cfg = { "100": { L1: 40, L2: 20 }, "200": { L1: 90 } };

  it("devolve o mapa {loja: base} da quantidade da cor", () => {
    expect(baseDaCor(cfg, 100)).toEqual({ L1: 40, L2: 20 });
    expect(baseDaCor(cfg, 200)).toEqual({ L1: 90 });
  });

  it("quantidade sem match -> {} (base 0)", () => {
    expect(baseDaCor(cfg, 150)).toEqual({});
    expect(baseDaCor(cfg, 0)).toEqual({});
  });

  it("config vazia/nula/lixo -> {} sem erro", () => {
    expect(baseDaCor({}, 100)).toEqual({});
    expect(baseDaCor(null, 100)).toEqual({});
    expect(baseDaCor(undefined, 100)).toEqual({});
    expect(baseDaCor({ "100": null } as never, 100)).toEqual({});
    expect(baseDaCor([] as never, 100)).toEqual({});
  });
});

describe("aplicarConfigPorCor", () => {
  const cfg = { "100": { L1: 40 }, "200": { L1: 90 } };
  const cores = [
    { key: "a", pcCard: 100 },
    { key: "b", pcCard: 200 },
    { key: "c", pcCard: 300 }, // qtd nao configurada
  ];

  it("cada cor pega a base da SUA quantidade; sem match -> base 0 (linha nao materializa)", () => {
    const out = aplicarConfigPorCor({ a: {}, b: {}, c: {} }, cfg, cores, ["L1"], prop, tamanhos);
    expect(out.a.L1.base).toBe(40);
    expect(out.b.L1.base).toBe(90);
    expect(out.c.L1).toBeUndefined();
  });

  it("CONGELAMENTO: com apenas=devePrePreencher pula a cor que ja tem distribuicao salva", () => {
    const salva: Distribuicao = { L1: { base: 5, grades: { "40|M": 2, "42|G": 3 }, manuais: [] } };
    const out = aplicarConfigPorCor({ a: salva, b: {} }, cfg, cores, ["L1"], prop, tamanhos, undefined, devePrePreencher);
    expect(out.a).toBe(salva); // intocada
    expect(out.b.L1.base).toBe(90);
  });

  it("sem filtro (recalcular) sobrescreve inclusive a cor salva, mantendo manual", () => {
    const salva: Distribuicao = { L1: { base: 5, grades: { "40|M": 7, "42|G": 3 }, manuais: ["40|M"] } };
    const out = aplicarConfigPorCor({ a: salva }, cfg, cores, ["L1"], prop, tamanhos);
    expect(out.a.L1.base).toBe(40);
    expect(out.a.L1.grades["40|M"]).toBe(7);
  });

  it("linha sem config (RPC {}) -> todas as cores base 0, sem NaN", () => {
    const out = aplicarConfigPorCor({ a: {}, b: {} }, {}, cores, ["L1", "L2"], prop, tamanhos);
    expect(out.a).toEqual({});
    expect(out.b).toEqual({});
  });

  it("chave de dists sem cor correspondente fica intocada", () => {
    const x: Distribuicao = { L1: { base: 1, grades: {}, manuais: [] } };
    const out = aplicarConfigPorCor({ z: x }, cfg, cores, ["L1"], prop, tamanhos);
    expect(out.z).toBe(x);
  });
});
