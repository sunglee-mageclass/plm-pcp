import { describe, it, expect } from "vitest";
import { proximaCelulaTeclado } from "@/lib/plan-tecido/calc";

// 3 linhas (blocos loja x cor), 2 colunas (Base + 1 tamanho)
const g = { nLinhas: 3, nColunas: 2 };
const k = (tecla: "Enter" | "Tab", comShift: boolean, linha: number, coluna: number) =>
  proximaCelulaTeclado({ tecla, comShift, linha, coluna, ...g });

describe("proximaCelulaTeclado (F2 D)", () => {
  it("Enter desce uma linha na mesma coluna", () => {
    expect(k("Enter", false, 0, 1)).toEqual({ linha: 1, coluna: 1 });
    expect(k("Enter", false, 1, 0)).toEqual({ linha: 2, coluna: 0 });
  });
  it("Enter na ultima linha nao sai da grade", () => {
    expect(k("Enter", false, 2, 1)).toBeNull();
  });
  it("Shift+Enter sobe uma linha; na primeira nao sai", () => {
    expect(k("Enter", true, 2, 1)).toEqual({ linha: 1, coluna: 1 });
    expect(k("Enter", true, 0, 1)).toBeNull();
  });
  it("Tab vai para a coluna a direita", () => {
    expect(k("Tab", false, 0, 0)).toEqual({ linha: 0, coluna: 1 });
  });
  it("Tab na ultima coluna estoura para a 1a coluna da proxima linha", () => {
    expect(k("Tab", false, 0, 1)).toEqual({ linha: 1, coluna: 0 });
  });
  it("Tab na ultima celula da grade nao sai (deixa o navegador seguir)", () => {
    expect(k("Tab", false, 2, 1)).toBeNull();
  });
  it("Shift+Tab volta para a esquerda", () => {
    expect(k("Tab", true, 0, 1)).toEqual({ linha: 0, coluna: 0 });
  });
  it("Shift+Tab na 1a coluna estoura para a ultima coluna da linha anterior", () => {
    expect(k("Tab", true, 1, 0)).toEqual({ linha: 0, coluna: 1 });
  });
  it("Shift+Tab na primeira celula da grade nao sai", () => {
    expect(k("Tab", true, 0, 0)).toBeNull();
  });
  it("grade vazia ou celula fora da grade devolve null", () => {
    expect(proximaCelulaTeclado({ tecla: "Tab", comShift: false, linha: 0, coluna: 0, nLinhas: 0, nColunas: 2 })).toBeNull();
    expect(proximaCelulaTeclado({ tecla: "Enter", comShift: false, linha: 5, coluna: 0, nLinhas: 3, nColunas: 2 })).toBeNull();
  });
});
