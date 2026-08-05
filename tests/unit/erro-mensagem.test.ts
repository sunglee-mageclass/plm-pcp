import { describe, it, expect } from "vitest";
import { mensagemErro } from "../../src/lib/erro-mensagem";

describe("mensagemErro", () => {
  it("P0409 (conflito de versão) vira mensagem PT amigável", () => {
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: x" }, "fallback"))
      .toMatch(/Outra pessoa salvou/);
  });
  it("P0001 continua passando a mensagem da RPC", () => {
    expect(mensagemErro({ code: "P0001", message: "Coleção de outra loja." }, "fb"))
      .toBe("Coleção de outra loja.");
  });

  // Regressão: o RAISE de falta/sobra do direcionamento (confirmar estrito por tamanho)
  // usava ERRCODE 23514 — vencia pra mensagem genérica de POR_CODIGO e o usuário nunca via
  // o tamanho/diferença. Fix: código virou P0001 (padrão do repo pra RAISE em PT), que passa
  // a mensagem da RPC direto.
  const msgFalta = "Falta direcionar 1 peça(s) no tamanho P (variante 1) — direcionado 4, grade real 5.";
  it("mensagem detalhada de falta no direcionamento sobrevive com P0001", () => {
    expect(mensagemErro({ code: "P0001", message: msgFalta })).toBe(msgFalta);
  });
  it("a MESMA mensagem seria engolida pela genérica se o código fosse 23514 (documenta o bug corrigido)", () => {
    expect(mensagemErro({ code: "23514", message: msgFalta }))
      .toBe("Um dos valores informados é inválido.");
  });
});
