import { describe, it, expect } from "vitest";
import { precoSugerido, precoInfo, custoSimulado } from "@/lib/preco";

describe("preco — custoSimulado (simulação de custo do Planejamento)", () => {
  it("tecido = consumo × preço/m; total soma aviamento + mão de obra", () => {
    const r = custoSimulado({ consumo_tecido: 1.35, preco_tecido_m: 28.9, aviamento: 4.5, mao_obra: 12 });
    expect(r.tecido).toBeCloseTo(1.35 * 28.9, 5);
    expect(r.total).toBeCloseTo(1.35 * 28.9 + 4.5 + 12, 5);
  });

  it("consumo sem preço (ou vice-versa) → tecido 0", () => {
    expect(custoSimulado({ consumo_tecido: 2, preco_tecido_m: 0 }).tecido).toBe(0);
    expect(custoSimulado({ consumo_tecido: 0, preco_tecido_m: 30 }).tecido).toBe(0);
    // sem tecido, o total ainda soma aviamento + MO
    expect(custoSimulado({ consumo_tecido: 2, aviamento: 3, mao_obra: 5 }).total).toBe(8);
  });

  it("nulos/indefinidos/negativos são tratados como 0", () => {
    expect(custoSimulado(null)).toEqual({ tecido: 0, total: 0 });
    expect(custoSimulado(undefined)).toEqual({ tecido: 0, total: 0 });
    expect(custoSimulado({})).toEqual({ tecido: 0, total: 0 });
    expect(custoSimulado({ consumo_tecido: -1, preco_tecido_m: -5, aviamento: -3, mao_obra: -2 })).toEqual({ tecido: 0, total: 0 });
  });

  it("integra com precoInfo: preço estimado = custoSimulado × markup → sugerido", () => {
    const { total } = custoSimulado({ consumo_tecido: 1, preco_tecido_m: 10, aviamento: 2, mao_obra: 3 }); // 15
    const pi = precoInfo(total, 2, null); // 15 × 2 = 30 → sugerido
    expect(total).toBe(15);
    expect(pi.preco).toBe(30);
    expect(pi.sugerido).toBe(precoSugerido(30)); // 34,90
    // sem markup (linha não definida) → preço 0
    expect(precoInfo(total, 0, null).sugerido).toBe(0);
  });
});

describe("preco — markup aplicado por modelo (4º parâmetro, markup_editado)", () => {
  it("aplicado > 0 forma o preço; o sugerido (linha) fica só como referência", () => {
    const pi = precoInfo(100, 2, null, 2.5);
    expect(pi.markupLinha).toBe(2); // sugerido
    expect(pi.markupAplicado).toBe(2.5); // aplicado forma o preço
    expect(pi.preco).toBe(250);
    expect(pi.sugerido).toBe(254.9);
  });

  it("sem 4º arg (call-site antigo) cai no markupLinha — byte-a-byte", () => {
    const pi = precoInfo(100, 2, null);
    expect(pi.markupAplicado).toBe(2);
    expect(pi.preco).toBe(200);
    expect(pi.sugerido).toBe(204.9);
  });

  it("null/undefined/0 no 4º arg = usa o markupLinha (mesmo resultado que omitir)", () => {
    expect(precoInfo(100, 2, null, null).preco).toBe(200);
    expect(precoInfo(100, 2, null, undefined).preco).toBe(200);
    expect(precoInfo(100, 2, null, 0).preco).toBe(200);
  });

  it("aplicado funciona mesmo sem markup na linha (linha 0)", () => {
    expect(precoInfo(100, 0, null, 2.5).sugerido).toBe(254.9);
  });

  it("markup real segue derivado do preço de venda efetivo — fórmula inalterada", () => {
    const pi = precoInfo(100, 2, 300, 2.5);
    expect(pi.markupReal).toBe(3);
    expect(pi.markupExibir).toBe(3);
    // sem preço de venda, markupExibir cai no aplicado (não mais no da linha)
    expect(precoInfo(100, 2, null, 2.5).markupExibir).toBeCloseTo(2.549, 3);
  });
});
