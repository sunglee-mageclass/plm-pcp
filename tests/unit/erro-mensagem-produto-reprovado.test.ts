// Paridade PA/PI (Task 3): `produto_reprovado_sem_card: <nome>` (P0001 ASCII da migration 20261118120000) vira texto PT na tela.
import { describe, it, expect } from "vitest";
import { mensagemErro, mensagemProdutoReprovadoSemCard } from "@/lib/erro-mensagem";

const P1 = (message: string) => ({ code: "P0001", message });

describe("mensagemProdutoReprovadoSemCard", () => {
  it("com nome: cita o produto e manda voltar a Pendente", () => {
    const t = "O produto \"Vestido Midi\" está reprovado — volte-o a Pendente para criar o card.";
    expect(mensagemErro(P1("produto_reprovado_sem_card: Vestido Midi"), "fb")).toBe(t);
    expect(mensagemProdutoReprovadoSemCard("P0001", "produto_reprovado_sem_card: Vestido Midi")).toBe(t);
  });
  it("sem nome: texto genérico", () => {
    expect(mensagemErro(P1("produto_reprovado_sem_card: "), "fb")).toBe("Este produto está reprovado — volte-o a Pendente para criar o card.");
  });
  it("outro código/prefixo não casa", () => {
    expect(mensagemProdutoReprovadoSemCard("42501", "produto_reprovado_sem_card: X")).toBeNull();
    expect(mensagemProdutoReprovadoSemCard("P0001", "outra coisa")).toBeNull();
  });
});
