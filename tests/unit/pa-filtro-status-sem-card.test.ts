import { describe, it, expect } from "vitest";
import { produtoPassaFiltroStatus } from "@/components/produto-acabado/shared";

describe("produtoPassaFiltroStatus", () => {
  it("sem_reprovado oculta produto SEM card reprovado", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: null, statusProduto: "reprovado" }, "sem_reprovado")).toBe(false);
  });
  it("sem_reprovado mostra produto sem card pendente", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: null, statusProduto: "pendente" }, "sem_reprovado")).toBe(true);
  });
  it("sem_reprovado mostra produto sem card sem status", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: null, statusProduto: null }, "sem_reprovado")).toBe(true);
  });
  it("com card: usa o status do modelo (kanban) — reprovado no modelo oculta, mesmo com statusProduto null", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: "m1", modeloStatusPlan: "reprovado", statusProduto: null }, "sem_reprovado")).toBe(false);
    expect(produtoPassaFiltroStatus({ modelo_id: "m1", modeloStatusDev: "Reprovado", statusProduto: null }, "sem_reprovado")).toBe(false);
  });
  it("com card: ignora statusProduto reprovado velho quando o modelo não é reprovado", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: "m1", modeloStatusPlan: "aprovado", statusProduto: "reprovado" }, "sem_reprovado")).toBe(true);
    expect(produtoPassaFiltroStatus({ modelo_id: "m1", statusProduto: "reprovado" }, "sem_reprovado")).toBe(true);
  });
  it("todos mostra tudo (nunca apaga)", () => {
    expect(produtoPassaFiltroStatus({ modelo_id: null, statusProduto: "reprovado" }, "todos")).toBe(true);
    expect(produtoPassaFiltroStatus({ modelo_id: "m1", modeloStatusPlan: "reprovado" }, "todos")).toBe(true);
  });
});
