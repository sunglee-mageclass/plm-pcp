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

    // Fix I-1 (revisão T3+T7, `.superpowers/sdd/2026-09-29-tamanho-em/review-t3-t7.md`) — 4º parâmetro OPCIONAL
    // `visiveis`: restringe a divisão IGUAL (ramo Σprop == 0) a um subconjunto de `tamanhos`. Caso do achado —
    // grade tipo Ark Store (36…44 soltos em número + PP…GG soltos em letra), "Tamanho em" = Letra, sem
    // proporção, Grade Total = 10 digitada: sem a fix, a conta dividia pelos 10 tamanhos da loja inteira
    // (metade ia para as numerações ocultas); com `visiveis` = só o lado Letra, os 10 caem SÓ em PP…GG.
    describe("visiveis (fix I-1) — restringe SÓ o ramo 'divide igualmente'", () => {
      const ARK = ["36", "38", "40", "42", "44", "PP", "P", "M", "G", "GG"];
      const LADO_LETRA = ["PP", "P", "M", "G", "GG"];

      it("Ark Store, sem proporção, Grade Total 10 → só PP…GG recebem (os soltos em número ficam a 0)", () => {
        const g = distribuiTotal(10, ARK, {}, LADO_LETRA);
        expect(somaGrade(g)).toBe(10); // Σ ainda bate com o total (ressalva #3: chaves continuam TODAS presentes)
        for (const t of ["36", "38", "40", "42", "44"]) expect(g[t]).toBe(0);
        // 10 ÷ 5 (PP,P,M,G,GG) = 2 cada, sem resto.
        expect(g).toEqual({ "36": 0, "38": 0, "40": 0, "42": 0, "44": 0, PP: 2, P: 2, M: 2, G: 2, GG: 2 });
      });

      it("sem `visiveis` (omitido): comportamento IDÊNTICO a antes — divide pelos 10 tamanhos da loja inteira", () => {
        const g = distribuiTotal(10, ARK, {});
        expect(somaGrade(g)).toBe(10);
        // 10 ÷ 10 = 1 cada, sem resto — TODOS recebem (é exatamente o bug que a fix corrige quando alguém passa
        // `visiveis`; sem o parâmetro, a chamada antiga continua se comportando assim).
        expect(g).toEqual({ "36": 1, "38": 1, "40": 1, "42": 1, "44": 1, PP: 1, P: 1, M: 1, G: 1, GG: 1 });
      });

      it("`visiveis` vazio (`[]`) cai de volta em `tamanhos` (guarda contra grade filtrada zerar tudo)", () => {
        const g = distribuiTotal(10, ARK, {}, []);
        expect(g).toEqual(distribuiTotal(10, ARK, {}));
      });

      it("`visiveis` NÃO afeta o ramo proporcional (Σprop > 0) — a proporção já decide quem recebe", () => {
        const props = { "36": 1, "38": 1, "40": 1, "42": 1, "44": 1, PP: 0, P: 0, M: 0, G: 0, GG: 0 };
        const comFiltro = distribuiTotal(50, ARK, props, LADO_LETRA);
        const semFiltro = distribuiTotal(50, ARK, props);
        expect(comFiltro).toEqual(semFiltro); // idêntico: `visiveis` só entra no ramo Σprop == 0
        expect(somaGrade(comFiltro)).toBe(50);
      });

      it("resto do arredondamento cai nos PRIMEIROS `visiveis` (não nos primeiros de `tamanhos`)", () => {
        // 11 ÷ 5 = 2 base, resto 1 → só o 1º de `visiveis` (PP) ganha o +1, nunca um tamanho fora da lista.
        const g = distribuiTotal(11, ARK, {}, LADO_LETRA);
        expect(somaGrade(g)).toBe(11);
        expect(g).toEqual({ "36": 0, "38": 0, "40": 0, "42": 0, "44": 0, PP: 3, P: 2, M: 2, G: 2, GG: 2 });
      });
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
