// Paridade PA/PI (Task 7): "Criar card" é TUDO-OU-NADA no servidor (1 reprovado derruba o lote inteiro com P0001
// `produto_reprovado_sem_card:`). O FRONT filtra os reprovados ANTES do RPC e avisa; o P0001 é só a rede de segurança.
import { describe, it, expect } from "vitest";
import { elegiveisParaCriarCard, textoAvisoReprovadosPulados } from "@/components/produto-acabado/shared";

describe("elegiveisParaCriarCard", () => {
  it("exclui produto reprovado (sem card)", () => {
    const r = elegiveisParaCriarCard([
      { id: "a", modelo_id: null, statusProduto: "reprovado" },
      { id: "b", modelo_id: null, statusProduto: "pendente" },
    ] as any);
    expect(r.elegiveis).toEqual(["b"]);
    expect(r.reprovados).toEqual(["a"]);
  });
  it("mantém pendente e sem status (null/undefined)", () => {
    const r = elegiveisParaCriarCard([
      { id: "a", modelo_id: null, statusProduto: "pendente" },
      { id: "b", modelo_id: null, statusProduto: null },
      { id: "c", modelo_id: null },
    ] as any);
    expect(r.elegiveis).toEqual(["a", "b", "c"]);
    expect(r.reprovados).toEqual([]);
  });
  it("todos reprovados → elegiveis vazio", () => {
    const r = elegiveisParaCriarCard([
      { id: "a", modelo_id: null, statusProduto: "reprovado" },
      { id: "b", modelo_id: null, statusProduto: "reprovado" },
    ] as any);
    expect(r.elegiveis).toEqual([]);
    expect(r.reprovados).toEqual(["a", "b"]);
  });
  it("produto que JÁ tem card não entra em nenhuma lista (nem reprovado)", () => {
    const r = elegiveisParaCriarCard([
      { id: "a", modelo_id: "M1", statusProduto: "reprovado" },
      { id: "b", modelo_id: "M2", statusProduto: null },
      { id: "c", modelo_id: null, statusProduto: null },
    ] as any);
    expect(r.elegiveis).toEqual(["c"]);
    expect(r.reprovados).toEqual([]);
  });
  it("ignora linha sem id (rascunho local sem persistir)", () => {
    const r = elegiveisParaCriarCard([{ id: undefined, modelo_id: null, statusProduto: null }] as any);
    expect(r.elegiveis).toEqual([]);
  });
});

describe("textoAvisoReprovadosPulados", () => {
  it("singular e plural em PT", () => {
    expect(textoAvisoReprovadosPulados(1)).toBe("1 produto reprovado não entra — volte a Pendente para criar o card.");
    expect(textoAvisoReprovadosPulados(3)).toBe("3 produtos reprovados não entram — volte a Pendente para criar o card.");
  });
});
