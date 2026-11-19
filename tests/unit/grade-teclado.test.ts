import { describe, it, expect } from "vitest";
import { proximaCelulaDisponivel } from "@/lib/grade-teclado";

// Grade 3x3. Predicado: todas disponíveis, salvo as marcadas em `bloq` (set de "L:C").
const pred = (bloq: Set<string>) => (l: number, c: number) => !bloq.has(`${l}:${c}`);

describe("proximaCelulaDisponivel", () => {
  it("Enter desce 1 linha, mesma coluna", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 0, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 1, coluna: 1 });
  });
  it("Enter pula a linha de baixo travada e para na próxima livre", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 0, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set(["1:1"])) }))
      .toEqual({ linha: 2, coluna: 1 });
  });
  it("Tab anda à direita", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 0, coluna: 1 });
  });
  it("Tab estoura para a próxima linha no fim da linha", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 2, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 1, coluna: 0 });
  });
  it("Tab pula travada na horizontal", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(new Set(["0:1"])) }))
      .toEqual({ linha: 0, coluna: 2 });
  });
  it("Shift+Tab inverso", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: true, linha: 1, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 0, coluna: 2 });
  });
  it("Shift+Enter sobe", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: true, linha: 2, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toEqual({ linha: 1, coluna: 1 });
  });
  it("borda: Enter na última linha → null", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 2, coluna: 1, nLinhas: 3, nColunas: 3, disponivel: pred(new Set()) }))
      .toBeNull();
  });
  it("todas as demais travadas → null sem loop infinito", () => {
    const bloq = new Set<string>();
    for (let l = 0; l < 3; l++) for (let c = 0; c < 3; c++) if (!(l === 0 && c === 0)) bloq.add(`${l}:${c}`);
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 0, nLinhas: 3, nColunas: 3, disponivel: pred(bloq) }))
      .toBeNull();
  });
});
