import { describe, it, expect } from "vitest";
import {
  m1ParaM2,
  m2ParaBrl,
  custoLanded,
  ratearPorPeso,
  cadeiaMarkup,
  fmtMoeda,
  simboloMoeda,
  type EntradaLanded,
} from "@/lib/moeda";

// Normaliza os espaços especiais do toLocaleString (NBSP   e narrow-NBSP  ) para
// espaço comum, senão a comparação de string de moeda falha por causa do separador.
const norm = (s: string) => s.replace(/[  ]/g, " ");

describe("moeda — conversões atômicas", () => {
  it("m1ParaM2 divide pela cotação da etapa (M1 por 1 M2)", () => {
    // 80 RMB ÷ 6 (RMB/USD) = 13,333...
    expect(m1ParaM2(80, 6)).toBeCloseTo(13.3333, 4);
  });
  it("m1ParaM2 com cotação ≤ 0 → 0 (evita divisão inválida)", () => {
    expect(m1ParaM2(80, 0)).toBe(0);
    expect(m1ParaM2(80, -1)).toBe(0);
  });
  it("m2ParaBrl multiplica pela cotação final (BRL por 1 M2)", () => {
    // 17,36 USD × 5,5 = 95,48
    expect(m2ParaBrl(17.36, 5.5)).toBeCloseTo(95.48, 2);
  });
});

describe("moeda — custoLanded degrada para a planilha-print quando as cotações são iguais", () => {
  // Print: 400 peças, 80 RMB/un, cotação 6, frete 0,35kg × 11,50 = 4,025/peça,
  // desconto 0%, sinal 30% + saldo 70% ambos na cotação 6, frete 100%, cotação final 5,5.
  const entrada: EntradaLanded = {
    valorUnitarioM1: 80,
    qtdTotal: 400,
    freteUnitarioM2: 0.35 * 11.5, // 4,025
    descontoPct: 0,
    etapas: [
      { base: "mercadoria", percentual: 30, cotacao: 6 },
      { base: "mercadoria", percentual: 70, cotacao: 6 },
      { base: "frete", percentual: 100, cotacao: 1 },
    ],
    cotacaoFinal: 5.5,
  };

  it("mercadoria em M2 = 32.000 RMB ÷ 6 = 5.333,33 USD", () => {
    const r = custoLanded(entrada);
    expect(r.mercadoriaM2).toBeCloseTo(5333.3333, 2);
  });
  it("frete em M2 = 0,35×11,50×400 = 1.610 USD", () => {
    const r = custoLanded(entrada);
    expect(r.freteM2).toBeCloseTo(1610, 2);
  });
  it("total em M2 = 6.943,33 USD (bate VALOR BRUTO do print)", () => {
    const r = custoLanded(entrada);
    expect(r.totalM2).toBeCloseTo(6943.3333, 2);
  });
  it("total BRL = 6.943,33 × 5,5 e unitário = 95,47 (bate VALOR FINAL do print)", () => {
    const r = custoLanded(entrada);
    expect(r.totalBrl).toBeCloseTo(38188.33, 1);
    expect(r.unitarioBrl).toBeCloseTo(95.47, 2);
  });
});

describe("moeda — custoLanded com cotações DIFERENTES por etapa (o caso real)", () => {
  it("sinal e saldo em dias diferentes usam taxas diferentes", () => {
    // 30% pago a 6,0 RMB/USD; 70% pago a 7,0 RMB/USD. Mercadoria M1 líquida = 80×400 = 32.000.
    const r = custoLanded({
      valorUnitarioM1: 80,
      qtdTotal: 400,
      freteUnitarioM2: 0,
      descontoPct: 0,
      etapas: [
        { base: "mercadoria", percentual: 30, cotacao: 6 },
        { base: "mercadoria", percentual: 70, cotacao: 7 },
      ],
      cotacaoFinal: 5.5,
    });
    // 30%×32000=9600 ÷6 = 1600 ; 70%×32000=22400 ÷7 = 3200 ; total = 4800 USD
    expect(r.mercadoriaM2).toBeCloseTo(4800, 2);
    expect(r.totalM2).toBeCloseTo(4800, 2);
  });
});

describe("moeda — desconto proporcional às duas bases", () => {
  it("desconto 10% reduz mercadoria E frete em 10%", () => {
    const semDesc = custoLanded({
      valorUnitarioM1: 100, qtdTotal: 10, freteUnitarioM2: 5, descontoPct: 0,
      etapas: [{ base: "mercadoria", percentual: 100, cotacao: 5 }, { base: "frete", percentual: 100, cotacao: 1 }],
      cotacaoFinal: 5,
    });
    const comDesc = custoLanded({
      valorUnitarioM1: 100, qtdTotal: 10, freteUnitarioM2: 5, descontoPct: 10,
      etapas: [{ base: "mercadoria", percentual: 100, cotacao: 5 }, { base: "frete", percentual: 100, cotacao: 1 }],
      cotacaoFinal: 5,
    });
    expect(comDesc.totalM2).toBeCloseTo(semDesc.totalM2 * 0.9, 4);
  });
});

describe("moeda — cadeia direta (sem M2)", () => {
  it("etapa converte M1→BRL e cotação final = 1", () => {
    // Compra em PYG direto pra BRL: 1000 PYG/un, cotação etapa = 1400 (PYG por 1 BRL), final = 1.
    const r = custoLanded({
      valorUnitarioM1: 1000, qtdTotal: 100, freteUnitarioM2: 0, descontoPct: 0,
      etapas: [{ base: "mercadoria", percentual: 100, cotacao: 1400 }],
      cotacaoFinal: 1,
    });
    // 100.000 PYG ÷ 1400 = 71,43 BRL total ; unit = 0,7143
    expect(r.totalBrl).toBeCloseTo(71.4286, 2);
    expect(r.unitarioBrl).toBeCloseTo(0.7143, 2);
  });
});

describe("moeda — ratearPorPeso (divisão simples, decisão do dono)", () => {
  it("distribui 400 por pesos 3/2/1/1/1", () => {
    const r = ratearPorPeso(400, { a: 3, b: 2, c: 1, d: 1, e: 1 });
    expect(r).toEqual({ a: 150, b: 100, c: 50, d: 50, e: 50 });
  });
  it("Σpesos ≤ 0 → tudo zero", () => {
    expect(ratearPorPeso(400, { a: 0, b: 0 })).toEqual({ a: 0, b: 0 });
  });
  it("pesos quebrados: arredonda por variante (total efetivo = Σ, pode divergir)", () => {
    const r = ratearPorPeso(10, { a: 1, b: 1, c: 1 }); // 10/3 = 3,33 → 3,3,3
    expect(r).toEqual({ a: 3, b: 3, c: 3 });
    expect(r.a + r.b + r.c).toBe(9); // diverge de 10 — comportamento documentado
  });
});

describe("moeda — cadeiaMarkup (custo → atacado → varejo)", () => {
  it("atacado = custo×mkA; varejo = atacado×mkV", () => {
    // print: 95,47 × 2 = 190,94 ; × 2 = 381,88
    const r = cadeiaMarkup(95.47, 2, 2);
    expect(r.atacado).toBeCloseTo(190.94, 2);
    expect(r.varejo).toBeCloseTo(381.88, 2);
  });
  it("markup ≤ 0 zera o preço correspondente", () => {
    expect(cadeiaMarkup(100, 0, 2)).toEqual({ atacado: 0, varejo: 0 });
    expect(cadeiaMarkup(100, 2, 0)).toEqual({ atacado: 200, varejo: 0 });
  });
});

describe("moeda — formatação", () => {
  it("fmtMoeda BRL usa o mesmo estilo de brl()", () => {
    expect(norm(fmtMoeda(1234.5, "BRL"))).toBe("R$ 1.234,50");
  });
  it("fmtMoeda USD/RMB = símbolo + número pt-BR", () => {
    expect(norm(fmtMoeda(13.33, "USD"))).toBe("US$ 13,33");
    expect(norm(fmtMoeda(80, "RMB"))).toBe("¥ 80,00");
  });
  it("fmtMoeda code desconhecido = code + número", () => {
    expect(norm(fmtMoeda(50, "XYZ"))).toBe("XYZ 50,00");
  });
  it("simboloMoeda conhecidos e fallback", () => {
    expect(simboloMoeda("USD")).toBe("US$");
    expect(simboloMoeda("PYG")).toBe("₲");
    expect(simboloMoeda("ZZZ")).toBe("ZZZ");
  });
});
