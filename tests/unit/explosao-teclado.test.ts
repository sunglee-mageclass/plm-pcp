// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { focarProximoInput } from "@/lib/explosao-teclado";

const proximoFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function montaTabela(n: number): { tabela: HTMLElement; inputs: HTMLInputElement[] } {
  const tabela = document.createElement("table");
  const inputs: HTMLInputElement[] = [];
  for (let i = 0; i < n; i++) {
    const inp = document.createElement("input");
    inp.setAttribute("data-colab-path", `c${i}`);
    tabela.appendChild(inp);
    inputs.push(inp);
    inp.focus = () => { (document as any)._focado = inp; };
  }
  document.body.appendChild(tabela);
  return { tabela, inputs };
}

describe("focarProximoInput", () => {
  it("Enter foca o PRÓXIMO input na ordem do DOM e retorna true", async () => {
    const { tabela, inputs } = montaTabela(3);
    const ok = focarProximoInput(inputs[0], tabela, "Enter", false);
    expect(ok).toBe(true);
    await proximoFrame(); // o foco é adiado com requestAnimationFrame
    expect((document as any)._focado).toBe(inputs[1]);
  });
  it("Shift+Enter foca o ANTERIOR", async () => {
    const { tabela, inputs } = montaTabela(3);
    const ok = focarProximoInput(inputs[2], tabela, "Enter", true);
    expect(ok).toBe(true);
    await proximoFrame(); // o foco é adiado com requestAnimationFrame
    expect((document as any)._focado).toBe(inputs[1]);
  });
  it("Enter no ÚLTIMO input retorna false (borda)", () => {
    const { tabela, inputs } = montaTabela(2);
    const ok = focarProximoInput(inputs[1], tabela, "Enter", false);
    expect(ok).toBe(false);
  });
  it("tabela com 1 input: retorna false", () => {
    const { tabela, inputs } = montaTabela(1);
    expect(focarProximoInput(inputs[0], tabela, "Enter", false)).toBe(false);
  });
});
