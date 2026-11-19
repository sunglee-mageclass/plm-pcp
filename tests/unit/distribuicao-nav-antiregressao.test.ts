import { describe, it, expect } from "vitest";
import { proximaCelulaDisponivel } from "@/lib/grade-teclado";

// A DistribuicaoTabelas é uma grade (lojas*cores) x (1 + tamanhos), tudo habilitado quando não bloqueado.
// Este teste fixa que os destinos de Enter/Tab/Shift são os de sempre (todas disponíveis).
describe("DistribuicaoTabelas navegação (anti-regressão)", () => {
  const nLinhas = 4, nColunas = 3; // ex.: 2 lojas * 2 cores, 1 base + 2 tamanhos
  const todas = () => true;
  it("Enter desce", () => {
    expect(proximaCelulaDisponivel({ tecla: "Enter", comShift: false, linha: 0, coluna: 0, nLinhas, nColunas, disponivel: todas }))
      .toEqual({ linha: 1, coluna: 0 });
  });
  it("Tab estoura no fim da linha", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: false, linha: 0, coluna: 2, nLinhas, nColunas, disponivel: todas }))
      .toEqual({ linha: 1, coluna: 0 });
  });
  it("Shift+Tab inverso", () => {
    expect(proximaCelulaDisponivel({ tecla: "Tab", comShift: true, linha: 1, coluna: 0, nLinhas, nColunas, disponivel: todas }))
      .toEqual({ linha: 0, coluna: 2 });
  });
});
