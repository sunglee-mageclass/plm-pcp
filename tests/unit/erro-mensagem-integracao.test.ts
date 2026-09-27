import { describe, it, expect } from "vitest";
import { mensagemErro } from "@/lib/erro-mensagem";

describe("mensagemErro — recusas da Integração (traduz pelo code + prefixo ASCII)", () => {
  it("trava de campo", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_travado: nome" })).toBe(
      'Produto travado pela Integração (integrável ou integrado): "Nome" não pode mudar. Volte para não integrável na tela Integração (ou, se já integrado, peça ao super admin para desfazer).');
    expect(mensagemErro({ code: "42501", message: "integracao_travado: tamanho_tipo" })).toMatch(/"Tamanho em" não pode mudar/);
  });
  it("trava de exclusão", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_travado: excluir" })).toBe(
      "Produto travado pela Integração (integrável ou integrado). Volte para não integrável na tela Integração antes de excluir.");
  });
  it("permissão de campo, custo, conflitos", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_sem_permissao: preco_venda" }))
      .toBe("Você não tem permissão para editar este campo (mesma regra do card do produto).");
    expect(mensagemErro({ code: "42501", message: "integracao_sem_custo: x" })).toBe('Com "Preço de custo" marcado, só integra quem pode ver custos.');
    expect(mensagemErro({ code: "P0409", message: "integracao_mudou: produto x mudou desde o resumo" }))
      .toBe("O produto mudou desde o resumo (outra pessoa editou, integrou ou voltou). Confira o resumo novo e confirme de novo.");
    expect(mensagemErro({ code: "P0409", message: "keywords_mudou: as keywords da loja mudaram" }))
      .toBe("Outra pessoa mudou as Keywords da loja enquanto você editava. O texto foi recarregado — confira e salve de novo.");
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: o produto foi salvo por outra pessoa" })).toMatch(/Outra pessoa salvou/);
  });
  it("42501 próprios da Integração mostram o motivo real", () => {
    expect(mensagemErro({ code: "42501", message: "Só o super admin pode fazer isto." })).toBe("Só o super admin pode fazer isto.");
    expect(mensagemErro({ code: "42501", message: "Sem permissão para editar a Integração." })).toBe("Sem permissão para editar a Integração.");
  });
});

// Revisão T5 Minor 4: 40P01 (deadlock detected) pode acontecer quando o mesmo produto comprado
// (revenda/importado) é salvo simultaneamente pelo Sheet do Planejamento e pela tela de Produto
// Acabado/Importado.
describe("mensagemErro — 40P01 (deadlock, ruling T5 Minor 4)", () => {
  it("deadlock detected vira mensagem PT amigável", () => {
    expect(mensagemErro({ code: "40P01", message: "deadlock detected" }))
      .toBe("Outra pessoa salvou este produto ao mesmo tempo. Tente de novo.");
  });
});
