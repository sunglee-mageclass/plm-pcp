import { describe, it, expect } from "vitest";
import { resumoProduto, type LinhaResumoProduto } from "@/lib/produto-resumo";

describe("resumoProduto (F4b — resumo de vendas PA/PI)", () => {
  it("soma poder de venda por canal (varejo e atacado) × peças", () => {
    const linhas: LinhaResumoProduto[] = [
      { pecas: 10, custoUnit: 50, precoVarejo: 150, precoAtacado: 100 },
      { pecas: 5, custoUnit: 20, precoVarejo: 60, precoAtacado: 40 },
    ];
    const r = resumoProduto(linhas);
    expect(r.poderVarejo).toBe(150 * 10 + 60 * 5); // 1800
    expect(r.poderAtacado).toBe(100 * 10 + 40 * 5); // 1200
    expect(r.qtd).toBe(2);
  });

  it("markup médio é a média aritmética do markup real (preço ÷ custo) por canal", () => {
    const linhas: LinhaResumoProduto[] = [
      { pecas: 1, custoUnit: 50, precoVarejo: 150, precoAtacado: 100 }, // varejo 3, atacado 2
      { pecas: 1, custoUnit: 20, precoVarejo: 60, precoAtacado: 40 },   // varejo 3, atacado 2
    ];
    const r = resumoProduto(linhas);
    expect(r.markupVarejo).toBeCloseTo(3, 10);
    expect(r.markupAtacado).toBeCloseTo(2, 10);
  });

  it("produto sem custo não entra no markup, mas entra no poder de venda", () => {
    const linhas: LinhaResumoProduto[] = [
      { pecas: 2, custoUnit: null, precoVarejo: 100, precoAtacado: 80 },
      { pecas: 1, custoUnit: 50, precoVarejo: 150, precoAtacado: 100 },
    ];
    const r = resumoProduto(linhas);
    expect(r.poderVarejo).toBe(100 * 2 + 150 * 1); // 350
    expect(r.poderAtacado).toBe(80 * 2 + 100 * 1); // 260
    // só a 2ª linha tem custo → markup = 3 (varejo) e 2 (atacado), não média com a sem custo
    expect(r.markupVarejo).toBeCloseTo(3, 10);
    expect(r.markupAtacado).toBeCloseTo(2, 10);
  });

  it("produto sem preço de um canal não conta naquele poder nem markup", () => {
    const linhas: LinhaResumoProduto[] = [
      { pecas: 3, custoUnit: 50, precoVarejo: 150, precoAtacado: null },
    ];
    const r = resumoProduto(linhas);
    expect(r.poderVarejo).toBe(150 * 3);
    expect(r.poderAtacado).toBe(0);
    expect(r.markupVarejo).toBeCloseTo(3, 10);
    expect(r.markupAtacado).toBe(0); // nenhum com atacado
  });

  it("peças negativas são clampadas em 0 (nunca subtraem do poder)", () => {
    const r = resumoProduto([{ pecas: -5, custoUnit: 50, precoVarejo: 150, precoAtacado: 100 }]);
    expect(r.poderVarejo).toBe(0);
    expect(r.poderAtacado).toBe(0);
  });

  it("lista vazia = tudo zero", () => {
    const r = resumoProduto([]);
    expect(r).toEqual({ poderVarejo: 0, poderAtacado: 0, markupVarejo: 0, markupAtacado: 0, qtd: 0 });
  });

  it("preço ou custo <= 0 não gera markup (espelha markupReal > 0 do Planejamento)", () => {
    const r = resumoProduto([
      { pecas: 1, custoUnit: 0, precoVarejo: 100, precoAtacado: 80 },
      { pecas: 1, custoUnit: 50, precoVarejo: 0, precoAtacado: 0 },
    ]);
    expect(r.markupVarejo).toBe(0);
    expect(r.markupAtacado).toBe(0);
    expect(r.poderVarejo).toBe(100); // 1ª linha tem preço varejo > 0
  });
});
