import { describe, it, expect } from "vitest";
import {
  gradeDaLoja, totalGrade, indiceReferencia, calcularTabela, calcularTotais,
  type TabelaDistribuicao,
} from "@/lib/distribuicao";

// grade-base da imagem de referência: 1,1,2,2,1,1 (34..44), 3 cores, 35 peças/mês
const GRADE = { "34": 1, "36": 1, "38": 2, "40": 2, "42": 1, "44": 1 };

describe("distribuicao — células puras", () => {
  it("gradeDaLoja multiplica a base pela grade-base", () => {
    expect(gradeDaLoja(GRADE, 5)).toEqual({ "34": 5, "36": 5, "38": 10, "40": 10, "42": 5, "44": 5 });
    expect(totalGrade(gradeDaLoja(GRADE, 5))).toBe(40);
  });

  it("indiceReferencia = 1ª loja com valorRef digitado", () => {
    expect(indiceReferencia([
      { loja_id: "a", base: 5, markup: 1.8, valorRef: null },
      { loja_id: "b", base: 4, markup: null, valorRef: 200 }, // referência
    ])).toBe(1);
    expect(indiceReferencia([{ loja_id: "a", base: 5, markup: 1.8, valorRef: null }])).toBe(-1);
  });
});

describe("distribuicao — tabela completa (números da imagem)", () => {
  // Atacado = referência (valor 200); E-commerce deriva por markup 1,8.
  const tab: TabelaDistribuicao = {
    gradeBase: GRADE, cores: 3, pecasMes: 35,
    lojas: [
      { loja_id: "ecom", base: 5, markup: 1.8, valorRef: null },
      { loja_id: "atacado", base: 4, markup: null, valorRef: 200 }, // referência
      { loja_id: "morumbi", base: 1, markup: 2.2, valorRef: null },
      { loja_id: "barra", base: 0, markup: 2.2, valorRef: null },
      { loja_id: "diamond", base: 1, markup: 2.2, valorRef: null },
      { loja_id: "moema", base: 1, markup: 2.2, valorRef: null },
      { loja_id: "catarina", base: 0, markup: 0, valorRef: null },
    ],
  };

  it("E-commerce: 40 peças → 120 cores → 4200 peças/mês → 360 (200×1,8) → R$ 1.512.000", () => {
    const l = calcularTabela(tab)[0];
    expect(l.total).toBe(40);
    expect(l.coresOut).toBe(120);
    expect(l.pecasMesOut).toBe(4200);
    expect(l.valorMedio).toBe(360);
    expect(l.poderVenda).toBe(1512000);
  });

  it("Atacado é a referência: valor 200 (não deriva), poder 672.000", () => {
    const l = calcularTabela(tab)[1];
    expect(l.ehReferencia).toBe(true);
    expect(l.valorMedio).toBe(200);
    expect(l.pecasMesOut).toBe(3360); // 32×3×35
    expect(l.poderVenda).toBe(672000);
  });

  it("Morumbi: 8 peças → 24 → 840 → 440 (200×2,2) → R$ 369.600", () => {
    const l = calcularTabela(tab)[2];
    expect(l.pecasMesOut).toBe(840);
    expect(l.valorMedio).toBe(440);
    expect(l.poderVenda).toBe(369600);
  });

  it("Barra base 0 → tudo zero (mas markup preservado)", () => {
    const l = calcularTabela(tab)[3];
    expect(l.total).toBe(0);
    expect(l.poderVenda).toBe(0);
    expect(l.valorMedio).toBe(440); // deriva mesmo com base 0
  });

  it("totais do rodapé fecham com a imagem: 96 / 288 / 10.080 / R$ 3.292.800", () => {
    const linhas = calcularTabela(tab);
    const tot = calcularTotais(GRADE, linhas);
    expect(tot.total).toBe(96);
    expect(tot.cores).toBe(288);
    expect(tot.pecasMes).toBe(10080);
    expect(tot.poderVenda).toBe(3292800);
    expect(tot.gradePorTam).toEqual({ "34": 12, "36": 12, "38": 24, "40": 24, "42": 12, "44": 12 });
  });

  it("loja com markup null (não digitado) → valor médio 0 mesmo com referência", () => {
    const comNull: TabelaDistribuicao = {
      gradeBase: GRADE, cores: 3, pecasMes: 35,
      lojas: [
        { loja_id: "atacado", base: 4, markup: null, valorRef: 200 }, // referência
        { loja_id: "semmk", base: 1, markup: null, valorRef: null },   // markup null → não deriva
      ],
    };
    const linhas = calcularTabela(comNull);
    expect(linhas[0].valorMedio).toBe(200); // referência
    expect(linhas[1].valorMedio).toBe(0);   // markup null → 0
    expect(linhas[1].poderVenda).toBe(0);
  });

  it("sem loja-referência (nenhum valorRef) → valor médio e poder = 0", () => {
    const semRef: TabelaDistribuicao = { ...tab, lojas: tab.lojas.map((l) => ({ ...l, valorRef: null })) };
    const linhas = calcularTabela(semRef);
    expect(linhas.every((l) => l.valorMedio === 0 && l.poderVenda === 0)).toBe(true);
    // grade/total/cores/peças continuam calculando
    expect(linhas[0].pecasMesOut).toBe(4200);
  });
});
