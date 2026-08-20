import { describe, it, expect } from "vitest";
import {
  distribuiTotal,
  distribuiAncora,
  redistribuiPorEscala,
  somaGrade,
  somaProporcao,
} from "@/lib/grade-proporcao";

const TAM = ["PPP", "PP", "P", "M", "G", "GG"];

describe("grade-proporcao — fonte única da grade automática", () => {
  describe("somaGrade / somaProporcao", () => {
    it("soma células ignorando não-numérico e nulos", () => {
      expect(somaGrade({ P: 3, M: 4, G: 0 })).toBe(7);
      expect(somaGrade(null)).toBe(0);
      expect(somaGrade({})).toBe(0);
    });
    it("soma proporções só dos tamanhos ativos", () => {
      expect(somaProporcao(TAM, { PPP: 1, PP: 1, P: 2, M: 2, G: 2, GG: 1 })).toBe(9);
      expect(somaProporcao(["P", "M"], { P: 3, G: 99 })).toBe(3);
      expect(somaProporcao(TAM, null)).toBe(0);
    });
  });

  describe("distribuiTotal — total → células (Σ === total EXATO)", () => {
    const props = { PPP: 1, PP: 1, P: 2, M: 2, G: 2, GG: 1 };
    it("distribui na proporção e o Σ bate com o total", () => {
      const g = distribuiTotal(90, TAM, props);
      expect(somaGrade(g)).toBe(90);
      expect(g).toEqual({ PPP: 10, PP: 10, P: 20, M: 20, G: 20, GG: 10 });
    });
    it("joga a diferença do arredondamento no tamanho de MAIOR proporção", () => {
      // total 100, Σprop 9 → 11.1.. por unidade; round dá 11,11,22,22,22,11 = 99; +1 no maior peso (P, 1º de prop 2)
      const g = distribuiTotal(100, TAM, props);
      expect(somaGrade(g)).toBe(100);
      expect(g.P).toBe(23); // P é o 1º tamanho com a maior proporção (2) → recebe o resíduo
      expect(g).toEqual({ PPP: 11, PP: 11, P: 23, M: 22, G: 22, GG: 11 });
    });
    it("sem proporções: divide IGUALMENTE (floor + resto nos primeiros), Σ === total", () => {
      const g = distribuiTotal(10, TAM, {});
      expect(somaGrade(g)).toBe(10);
      // 10/6 = 1 base, resto 4 → primeiros 4 tamanhos ganham +1
      expect(g).toEqual({ PPP: 2, PP: 2, P: 2, M: 2, G: 1, GG: 1 });
    });
    it("total 0 zera todas as células", () => {
      expect(distribuiTotal(0, TAM, props)).toEqual({ PPP: 0, PP: 0, P: 0, M: 0, G: 0, GG: 0 });
    });
    it("Σ === total para uma varredura de totais (invariante)", () => {
      for (const total of [1, 7, 13, 50, 137, 999]) {
        expect(somaGrade(distribuiTotal(total, TAM, props))).toBe(total);
        expect(somaGrade(distribuiTotal(total, TAM, {}))).toBe(total); // sem proporção também fecha
      }
    });
  });

  describe("distribuiAncora — célula digitada é âncora, demais por proporção", () => {
    it("PPP=30 com prop 1·1·2·2·2·1 → 30·30·60·60·60·30 (âncora exata)", () => {
      const g = distribuiAncora(30, "PPP", TAM, { PPP: 1, PP: 1, P: 2, M: 2, G: 2, GG: 1 });
      expect(g).toEqual({ PPP: 30, PP: 30, P: 60, M: 60, G: 60, GG: 30 });
      expect(g.PPP).toBe(30);
    });
    it("mantém o valor EXATO da âncora mesmo com arredondamento nos outros", () => {
      const g = distribuiAncora(7, "M", TAM, { PPP: 1, PP: 1, P: 1, M: 3, G: 1, GG: 1 });
      expect(g.M).toBe(7); // âncora intacta
      expect(g.PPP).toBe(Math.round((7 / 3) * 1)); // 2
    });
  });

  describe("redistribuiPorEscala — round(unit * prop)", () => {
    it("aplica a unidade dada em cada tamanho", () => {
      const g = redistribuiPorEscala(10, TAM, { PPP: 1, PP: 1, P: 2, M: 2, G: 2, GG: 1 });
      expect(g).toEqual({ PPP: 10, PP: 10, P: 20, M: 20, G: 20, GG: 10 });
    });
  });
});
