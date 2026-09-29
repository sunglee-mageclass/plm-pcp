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

describe("mensagemErro — Kanban automático (RPCs da F1)", () => {
  const PROPRIAS_42501 = [
    "Apenas o administrador da loja pode ver a prévia do Kanban automático.",
    "Apenas o administrador da loja pode ligar ou desligar o Kanban automático.",
    "Apenas o administrador da loja pode restaurar as colunas do Kanban.",
    "Sem permissão para mover cards do Desenvolvimento.",
  ];
  it("42501 com mensagem PRÓPRIA do kanban passa direto (não vira a genérica)", () => {
    for (const m of PROPRIAS_42501) expect(mensagemErro({ code: "42501", message: m }, "fb")).toBe(m);
  });
  it("42501 de outra origem continua genérico", () => {
    expect(mensagemErro({ code: "42501", message: "permission denied for table modelos" }, "fb"))
      .toBe("Você não tem permissão para esta ação.");
    expect(mensagemErro({ code: "42501", message: "Loja inativa ou sem tenant — operação não permitida." }, "fb"))
      .toBe("Você não tem permissão para esta ação.");
  });
  it("P0001 e P0002 do kanban passam direto", () => {
    for (const m of [
      "O Kanban automático está desligado nesta loja.",
      "Desligue o Kanban automático antes de restaurar as colunas.",
      "Este lote já foi restaurado.",
      'A etapa "zzz" não faz parte do fluxo deste modelo.',
    ]) expect(mensagemErro({ code: "P0001", message: m }, "fb")).toBe(m);
    for (const m of ["Modelo não encontrado.", "Lote de colunas não encontrado.", "Configuração da loja não encontrada."])
      expect(mensagemErro({ code: "P0002", message: m }, "fb")).toBe(m);
  });
});

describe("mensagemErro — \"Tamanho em\" nos cards (20261014100000)", () => {
  it("P0001 'tamanho_tipo invalido: …' (ASCII do banco) vira texto PT", () => {
    expect(mensagemErro({ code: "P0001", message: "tamanho_tipo invalido: use letra ou numero" }, "fb"))
      .toBe('O "Tamanho em" precisa ser Letra ou Número.');
  });
  it("outros P0001 seguem passando a mensagem da RPC", () => {
    expect(mensagemErro({ code: "P0001", message: "Informe o nome do produto." }, "fb")).toBe("Informe o nome do produto.");
  });
});
