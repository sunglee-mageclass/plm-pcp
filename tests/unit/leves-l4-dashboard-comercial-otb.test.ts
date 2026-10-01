import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { agregarComercial, gradePlanejadaPorModelo } from "@/lib/dashboard-comercial";
import { computeColecaoResumo } from "@/components/otb/otb-resumo";

const dashboardSrc = () =>
  readFileSync(resolve(__dirname, "../../src/routes/_authenticated/dashboard.tsx"), "utf8");

// Achados LEVES L4, prod #14 (aba Comercial & Coleção): card com custo 0 (sem custo ou mascarado) virava margem de 100%
// e lucro = poder de venda; e a query da grade planejada engolia o erro (virava "0 peças" em silêncio).
describe("agregarComercial (L4 prod #14)", () => {
  const linha = { nome: "Vestidos", markup: 2.5, markup_min: 2, markup_max: 3 };
  const modelos = [
    { id: "a", colecao: "Verão", linha_id: "L1", preco_venda: 100, markup_editado: null, linha },
    // custo 0 com preço: antes entrava com lucro 100 por peça (margem 100%)
    { id: "b", colecao: "Verão", linha_id: "L1", preco_venda: 100, markup_editado: null, linha },
  ];
  const custoMap = {
    a: { previsto: 40, real: 40, confirmado: true },
    b: { previsto: 0, real: 0, confirmado: false },
  };
  const gradePlan = { a: 10, b: 10 };
  const gradeReal = { a: 10, b: 10 };

  it("custo 0 fica fora da margem e do lucro, e é contado como 'sem custo'", () => {
    const { tot, porLinha, porColecao } = agregarComercial(modelos, custoMap, gradePlan, gradeReal);
    // poder de venda segue com os dois (preço existe)
    expect(tot.pvPlan).toBe(2000);
    expect(tot.pvReal).toBe(2000);
    // lucro só do card com custo: (100 - 40) × 10
    expect(tot.lucroPlan).toBe(600);
    expect(tot.lucroReal).toBe(600);
    // margem = lucro ÷ poder de venda DOS CARDS COM CUSTO = 60% (antes: 1600/2000 = 80%)
    expect(tot.margemPlan).toBeCloseTo(60, 9);
    expect(tot.margemReal).toBeCloseTo(60, 9);
    expect(tot.markupReal).toBeCloseTo(2.5, 9);
    expect(tot.semCusto).toBe(1);
    // ticket = poder de venda ÷ peças (todas)
    expect(tot.ticket).toBe(100);
    expect(porLinha[0].semCusto).toBe(1);
    expect(porLinha[0].lucroReal).toBe(600);
    expect(porLinha[0].pvRealComCusto).toBe(1000);
    expect(porColecao[0].pvRealComCusto).toBe(1000);
  });

  it("custo mascarado (sem permissão: mapa vazio) não vira margem 100%: margem 0 e todos 'sem custo'", () => {
    const { tot } = agregarComercial(modelos, {}, gradePlan, gradeReal);
    expect(tot.pvPlan).toBe(2000);
    expect(tot.lucroPlan).toBe(0);
    expect(tot.margemPlan).toBe(0);
    expect(tot.margemReal).toBe(0);
    expect(tot.markupReal).toBe(0);
    expect(tot.semCusto).toBe(2);
  });

  it("card sem custo e sem grade não entra na contagem 'sem custo' (não pesaria na margem)", () => {
    const { tot } = agregarComercial(modelos, custoMap, { a: 10 }, {});
    expect(tot.semCusto).toBe(0);
  });

  it("custo real tem prioridade; sem real cai no previsto (como antes)", () => {
    const { tot } = agregarComercial(
      [modelos[0]],
      { a: { previsto: 50, real: 0, confirmado: false } },
      { a: 2 },
      {},
    );
    expect(tot.lucroPlan).toBe(100); // (100 - 50) × 2
  });
});

describe("gradePlanejadaPorModelo (L4 prod #14)", () => {
  it("erro da query LANÇA (não vira grade 0 em silêncio)", async () => {
    const erro = { message: "permission denied", code: "42501" };
    await expect(
      gradePlanejadaPorModelo(Promise.resolve({ data: null, error: erro })),
    ).rejects.toBe(erro);
  });

  it("soma grade_total por modelo", async () => {
    const r = await gradePlanejadaPorModelo(
      Promise.resolve({
        data: [
          { modelo_id: "a", grade_total: 3 },
          { modelo_id: "a", grade_total: "4" },
          { modelo_id: "b", grade_total: null },
        ],
        error: null,
      }),
    );
    expect(r).toEqual({ a: 7, b: 0 });
  });

  it("dashboard.tsx usa o helper na comercial-grade-plan e a agregação única", () => {
    const src = dashboardSrc();
    const bloco = src.slice(
      src.indexOf('queryKey: ["comercial-grade-plan"'),
      src.indexOf('queryKey: ["comercial-grade-real"'),
    );
    expect(bloco).toMatch(/gradePlanejadaPorModelo\(/);
    expect(src).toMatch(/agregarComercial\(modelos, custoMap/);
    // a query de custo também não engole o erro
    const custo = src.slice(
      src.indexOf('queryKey: ["comercial-custo"'),
      src.indexOf('queryKey: ["comercial-grade-plan"'),
    );
    expect(custo).toMatch(/if \(error\) throw error/);
  });
});

// Achados LEVES L4, prod #12: o número ao lado da média conta MODELOS (a média é por modelo: soma dos trechos de cada
// modelo na etapa); a dica explica a conta.
describe("Leadtime: rótulo e dica da média (L4 prod #12)", () => {
  it("BulletSection tem a dica (InfoHover) explicando a média por modelo", () => {
    const src = dashboardSrc();
    const bs = src.slice(
      src.indexOf("function BulletSection("),
      src.indexOf("function LeadtimeHero("),
    );
    expect(bs).toMatch(/<InfoHover ariaLabel="Como a média é calculada"/);
    expect(bs).toMatch(/soma/);
  });
});

// Achados LEVES L4, est #15 / P-209 A: card reprovado não conta no Realizado do OTB — nem no poder de venda / custo do
// resumo da coleção (mesma regra do banco: lower(status_desenvolvimento) = 'reprovado').
describe("computeColecaoResumo sem reprovado (L4 P-209 A)", () => {
  const custo = {
    a: { previsto: 10, real: 12, confirmado: true },
    b: { previsto: 20, real: 20, confirmado: true },
  };
  const grade = { a: 2, b: 3 };
  it("reprovado fica fora de previsto/real/poder/qtd; sair de Reprovado volta a contar", () => {
    const base = [
      { id: "a", linha_id: null, preco_venda: 50, status_desenvolvimento: "em_modelagem" },
      { id: "b", linha_id: null, preco_venda: 80, status_desenvolvimento: "Reprovado" },
    ];
    const r = computeColecaoResumo(base, custo, grade, {});
    expect(r.qtdModelos).toBe(1);
    expect(r.qtdPecas).toBe(2);
    expect(r.previsto).toBe(20);
    expect(r.real).toBe(24);
    expect(r.poder).toBe(100);
    const volta = computeColecaoResumo(
      base.map((m) => (m.id === "b" ? { ...m, status_desenvolvimento: "em_ajuste" } : m)),
      custo,
      grade,
      {},
    );
    expect(volta.qtdModelos).toBe(2);
    expect(volta.poder).toBe(100 + 240);
  });

  it("as telas do OTB leem status_desenvolvimento para o resumo", () => {
    const idx = readFileSync(
      resolve(__dirname, "../../src/routes/_authenticated/otb.index.tsx"),
      "utf8",
    );
    const sheet = readFileSync(
      resolve(__dirname, "../../src/components/otb/ColecaoSheet.tsx"),
      "utf8",
    );
    expect(idx).toMatch(
      /select\("id, colecao_id, linha_id, preco_venda, markup_editado, status_planejamento, status_desenvolvimento"\)/,
    );
    expect(sheet).toMatch(
      /select\("id, linha_id, preco_venda, markup_editado, status_planejamento, status_desenvolvimento, subcolecao"\)/,
    );
  });
});
