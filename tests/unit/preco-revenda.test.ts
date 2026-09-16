import { describe, it, expect } from "vitest";
import { precoAtacado, precoVarejo, markupDePreco, arred2 } from "@/lib/preco-revenda";

describe("preco-revenda — atacado e varejo INDEPENDENTES (mesma base)", () => {
  it("atacado = base × mk_atacado; varejo = base × mk_varejo (não encadeado)", () => {
    const base = 100;
    expect(precoAtacado(base, 1.5)).toBe(150);
    expect(precoVarejo(base, 2.5)).toBe(250); // 100×2,5 = 250 (NÃO 150×2,5 = 375, que era o encadeado)
  });

  it("só varejo (sem atacado) já produz preço de varejo — não depende do atacado existir", () => {
    expect(precoVarejo(100, 2)).toBe(200);
    expect(precoAtacado(100, null)).toBeNull(); // atacado ausente não afeta o varejo
  });

  it("markup nulo/zero/negativo → null (não vira 0)", () => {
    expect(precoAtacado(100, null)).toBeNull();
    expect(precoVarejo(100, 0)).toBeNull();
    expect(precoAtacado(100, -1)).toBeNull();
  });

  it("base zero/negativa → null (produto sem valor unitário ainda)", () => {
    expect(precoAtacado(0, 1.5)).toBeNull();
    expect(precoVarejo(0, 2.5)).toBeNull();
  });

  it("arredondamento a 2 casas (espelha round(x,2) do SQL)", () => {
    expect(precoVarejo(33.33, 1.5)).toBe(50); // 49.995 → 50.00
    expect(precoAtacado(10.1, 1.234)).toBe(12.46); // 12.4634 → 12.46
    expect(arred2(2.005)).toBe(2.01);
  });
});

describe("preco-revenda — caminho INVERSO (preço → markup)", () => {
  it("markup = preço ÷ base", () => {
    expect(markupDePreco(100, 150)).toBe(1.5);
    expect(markupDePreco(100, 250)).toBe(2.5);
    expect(markupDePreco(100, 180)).toBe(1.8);
  });

  it("round-trip: markup → preço → markup fecha (nos casos exatos)", () => {
    const base = 100;
    const p = precoVarejo(base, 2.5)!; // 250
    expect(markupDePreco(base, p)).toBe(2.5);
  });

  it("base ≤ 0 → null (evita ÷0)", () => {
    expect(markupDePreco(0, 150)).toBeNull();
    expect(markupDePreco(-10, 150)).toBeNull();
  });

  it("preço ≤ 0 → null (banco rejeita markup ≤ 0)", () => {
    expect(markupDePreco(100, 0)).toBeNull();
    expect(markupDePreco(100, null)).toBeNull();
    expect(markupDePreco(100, -5)).toBeNull();
  });

  it("markup do inverso arredonda a 2 casas", () => {
    expect(markupDePreco(3, 10)).toBe(3.33); // 3.3333 → 3.33
  });
});
